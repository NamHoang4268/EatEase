import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const sockets = vi.hoisted(() => ({
  all: [] as Array<{
    auth: unknown;
    handlers: Map<string, (...args: unknown[]) => void>;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    removeAllListeners: ReturnType<typeof vi.fn>;
  }>,
}));
vi.mock('socket.io-client', () => ({
  io: vi.fn((_url, options) => {
    const socket = {
      auth: options.auth,
      handlers: new Map(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      on: vi.fn(),
      removeAllListeners: vi.fn(),
    };
    socket.on.mockImplementation((name, callback) => {
      socket.handlers.set(name, callback);
      return socket;
    });
    socket.removeAllListeners.mockImplementation(() => {
      socket.handlers.clear();
    });
    sockets.all.push(socket);
    return socket;
  }),
}));
import { io } from 'socket.io-client';
import { useRealtime } from './use-realtime';

const response = () =>
  new Response(
    JSON.stringify({ data: { ticket: 'volatile-ticket', url: 'http://localhost:3001' } }),
    { status: 201 },
  );
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv('NEXT_PUBLIC_REALTIME_ENABLED', 'true');
  sockets.all.length = 0;
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const tick = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

describe('realtime client', () => {
  it('obtains same-origin POST tickets and keeps proof out of socket URLs and browser storage', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetchMock);
    const invalidate = vi.fn();
    renderHook(() =>
      useRealtime({
        actor: 'staff',
        audience: 'kitchen',
        enabled: true,
        csrfToken: 'csrf',
        onInvalidate: invalidate,
      }),
    );
    await tick(0);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/staff/realtime/tickets',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'csrf' },
        body: '{"audience":"kitchen"}',
      }),
    );
    expect(io).toHaveBeenCalledWith(
      'http://localhost:3001',
      expect.objectContaining({
        transports: ['websocket'],
        auth: { ticket: 'volatile-ticket' },
        reconnection: false,
        withCredentials: false,
      }),
    );
    act(() => sockets.all[0]!.handlers.get('connect')!());
    await tick(250);
    expect(invalidate).toHaveBeenCalledOnce();
    expect(sockets.all[0]!.auth).toEqual({});
    expect(localStorage.getItem('ticket')).toBeNull();
    expect(sessionStorage.getItem('ticket')).toBeNull();
  });
  it('coalesces duplicates, bursts and out-of-order hints without applying business state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()));
    const invalidate = vi.fn();
    renderHook(() =>
      useRealtime({
        actor: 'guest',
        audience: 'bill',
        enabled: true,
        csrfToken: 'csrf',
        onInvalidate: invalidate,
      }),
    );
    await tick(0);
    act(() => {
      const emit = sockets.all[0]!.handlers.get('invalidate')!;
      emit({ eventId: 'same', version: 2 });
      emit({ eventId: 'same', version: 2 });
      emit({ eventId: 'older', version: 1 });
    });
    await tick(250);
    expect(invalidate).toHaveBeenCalledOnce();
    act(() => sockets.all[0]!.handlers.get('invalidate')!({ eventId: 'same' }));
    await tick(250);
    expect(invalidate).toHaveBeenCalledOnce();
  });
  it('requests a fresh ticket and refetches on reconnect instead of reusing a consumed ticket', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => response());
    vi.stubGlobal('fetch', fetchMock);
    const invalidate = vi.fn();
    renderHook(() =>
      useRealtime({
        actor: 'staff',
        audience: 'sessions',
        enabled: true,
        csrfToken: 'csrf',
        onInvalidate: invalidate,
      }),
    );
    await tick(0);
    act(() => sockets.all[0]!.handlers.get('connect')!());
    await tick(250);
    act(() => sockets.all[0]!.handlers.get('disconnect')!('transport close'));
    await tick(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    act(() => sockets.all[1]!.handlers.get('connect')!());
    await tick(250);
    expect(invalidate).toHaveBeenCalledTimes(2);
  });
  it('recovers CSRF once and preserves the existing HTTP session if recovery fails', async () => {
    const recoverCsrf = vi.fn().mockResolvedValue('replacement');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: 'STAFF_CSRF_INVALID' } }), { status: 403 }),
      )
      .mockResolvedValueOnce(response());
    vi.stubGlobal('fetch', fetchMock);
    renderHook(() =>
      useRealtime({
        actor: 'staff',
        audience: 'bill',
        tableSessionId: 'id',
        enabled: true,
        csrfToken: 'stale',
        recoverCsrf,
        onInvalidate: vi.fn(),
      }),
    );
    await tick(0);
    expect(recoverCsrf).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      headers: { 'X-CSRF-Token': 'replacement' },
      body: '{"audience":"bill","tableSessionId":"id"}',
    });
  });
  it('bounds network retries and allows explicit retry after exhaustion', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() =>
      useRealtime({
        actor: 'staff',
        audience: 'kitchen',
        enabled: true,
        csrfToken: 'csrf',
        onInvalidate: vi.fn(),
      }),
    );
    await tick(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(result.current.status).toBe('offline');
    await tick(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(7);
    act(() => result.current.reconnect());
    await tick(0);
    expect(fetchMock).toHaveBeenCalledTimes(8);
  });
  it('aborts ticket issuance and disconnects on unmount', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetchMock);
    const { unmount } = renderHook(() =>
      useRealtime({
        actor: 'guest',
        audience: 'bill',
        enabled: true,
        csrfToken: 'csrf',
        onInvalidate: vi.fn(),
      }),
    );
    await tick(0);
    unmount();
    expect(fetchMock.mock.calls[0]?.[1].signal.aborted).toBe(true);
    expect(sockets.all[0]!.disconnect).toHaveBeenCalledOnce();
  });

  it('retries transient 5xx but stops on definitive authorization failure', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response('{}', { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() =>
      useRealtime({
        actor: 'staff',
        audience: 'kitchen',
        enabled: true,
        csrfToken: 'csrf',
        onInvalidate: vi.fn(),
      }),
    );
    await tick(0);
    await tick(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('offline');
    await tick(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sockets.all).toHaveLength(0);
  });

  it('performs one trailing read when new hints arrive during an existing refetch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()));
    let release!: () => void;
    const invalidate = vi.fn().mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    renderHook(() =>
      useRealtime({
        actor: 'guest',
        audience: 'bill',
        enabled: true,
        csrfToken: 'csrf',
        onInvalidate: invalidate,
      }),
    );
    await tick(0);
    act(() => sockets.all[0]!.handlers.get('connect')!());
    await tick(250);
    act(() => {
      const emit = sockets.all[0]!.handlers.get('invalidate')!;
      emit({ eventId: 'one' });
      emit({ eventId: 'two' });
    });
    await tick(250);
    expect(invalidate).toHaveBeenCalledOnce();
    await act(async () => {
      release();
    });
    await tick(250);
    expect(invalidate).toHaveBeenCalledTimes(2);
  });
});
