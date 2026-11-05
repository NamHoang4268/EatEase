'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

type Options = {
  actor: 'staff' | 'guest';
  audience: 'kitchen' | 'activation' | 'sessions' | 'bill';
  enabled: boolean;
  csrfToken: string | null | undefined;
  tableSessionId?: string;
  onInvalidate: () => void | Promise<void>;
  recoverCsrf?: () => Promise<string>;
};
export type RealtimeStatus = 'disabled' | 'connecting' | 'connected' | 'offline';

export function useRealtime(options: Options): { status: RealtimeStatus; reconnect: () => void } {
  const [status, setStatus] = useState<RealtimeStatus>('disabled');
  const [retry, setRetry] = useState(0);
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  const { actor, audience, enabled, csrfToken, tableSessionId } = options;
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_REALTIME_ENABLED !== 'true' || !enabled || !csrfToken) return;
    let stopped = false;
    let socket: Socket | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let fetching = false;
    let dirty = false;
    const seen = new Set<string>();
    const controller = new AbortController();

    // Coalesce bursts; a hint arriving during refetch causes one trailing refetch.
    const refresh = async () => {
      if (stopped) return;
      if (fetching) {
        dirty = true;
        return;
      }
      fetching = true;
      try {
        await latest.current.onInvalidate();
      } catch {
        /* Existing HTTP view displays its error. */
      } finally {
        fetching = false;
        if (dirty && !stopped) {
          dirty = false;
          queueRefresh();
        }
      }
    };
    const queueRefresh = () => {
      if (!refreshTimer && !stopped)
        refreshTimer = setTimeout(() => {
          refreshTimer = undefined;
          void refresh();
        }, 250);
    };
    const schedule = () => {
      if (stopped || retryTimer) return;
      setStatus('offline');
      if (attempts >= 6) return; // Bounded retries; manual retry/refresh remains available.
      const delay = Math.min(30_000, 1000 * 2 ** attempts++);
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        void connect();
      }, delay);
    };
    const connect = async () => {
      if (stopped) return;
      socket?.removeAllListeners();
      socket?.disconnect();
      setStatus('connecting');
      try {
        const send = (token: string) =>
          fetch(`/api/v1/${actor}/realtime/tickets`, {
            method: 'POST',
            credentials: 'include',
            cache: 'no-store',
            signal: controller.signal,
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
            body: JSON.stringify({ audience, ...(tableSessionId ? { tableSessionId } : {}) }),
          });
        let response = await send(latest.current.csrfToken ?? csrfToken);
        if (response.status === 403 && latest.current.recoverCsrf) {
          const error = (await response
            .clone()
            .json()
            .catch(() => null)) as { error?: { code?: string } } | null;
          if (
            error?.error?.code === 'STAFF_CSRF_INVALID' ||
            error?.error?.code === 'GUEST_CSRF_INVALID'
          ) {
            response = await send(await latest.current.recoverCsrf());
          }
        }
        if (stopped) return;
        if ([401, 403].includes(response.status)) {
          // Fail closed; do not alter the HTTP-auth state or existing draft.
          setStatus('offline');
          return;
        }
        if (response.status === 503) {
          const payload = (await response
            .clone()
            .json()
            .catch(() => null)) as { error?: { code?: string } } | null;
          if (payload?.error?.code === 'REALTIME_DISABLED') {
            setStatus('offline');
            return;
          }
        }
        if (!response.ok) throw new Error('REALTIME_TICKET_FAILED');
        const { data } = (await response.json()) as { data: { ticket: string; url: string } };
        if (stopped) return;
        // Ticket lives only in volatile Socket.IO auth; never URL/storage.
        socket = io(data.url, {
          autoConnect: false,
          transports: ['websocket'],
          reconnection: false,
          withCredentials: false,
          forceNew: true,
          timeout: 10_000,
          auth: { ticket: data.ticket },
        });
        socket.on('connect', () => {
          if (stopped) return;
          socket!.auth = {};
          attempts = 0;
          seen.clear();
          setStatus('connected');
          queueRefresh(); // Includes initial race window and every reconnect/missed event.
        });
        socket.on('invalidate', (value: unknown) => {
          if (
            !value ||
            typeof value !== 'object' ||
            !('eventId' in value) ||
            typeof value.eventId !== 'string'
          )
            return;
          if (seen.has(value.eventId)) return;
          seen.add(value.eventId);
          if (seen.size > 256) seen.delete(seen.values().next().value!);
          queueRefresh();
        });
        socket.on('disconnect', schedule);
        socket.on('connect_error', () => {
          socket!.auth = {};
          schedule();
        });
        socket.connect();
      } catch {
        if (!stopped) schedule();
      }
    };
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      void connect();
    }, 0);
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(retryTimer);
      clearTimeout(refreshTimer);
      socket?.removeAllListeners();
      socket?.disconnect();
    };
  }, [actor, audience, enabled, csrfToken, tableSessionId, retry]);
  return {
    status:
      process.env.NEXT_PUBLIC_REALTIME_ENABLED === 'true' && enabled && csrfToken
        ? status
        : 'disabled',
    reconnect: useCallback(() => setRetry((value) => value + 1), []),
  };
}
