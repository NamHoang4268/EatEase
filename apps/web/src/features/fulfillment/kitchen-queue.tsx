'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRealtime } from '../realtime/use-realtime';
import { RealtimeNotice } from '../realtime/realtime-notice';

type QueueItem = {
  id: string;
  nameSnapshot: string;
  quantity: number;
  note: string | null;
  stationSnapshot: 'KITCHEN' | 'BAR' | 'DIRECT';
  status: 'NEW' | 'PREPARING' | 'READY' | 'SERVED' | 'CANCELLED';
  version: number;
  order: {
    id: string;
    orderNumber: string;
    source: 'QR_GUEST' | 'STAFF_WAITER';
    submittedAt: string;
  };
  table: { code: string };
  cancellationRequest: {
    id: string;
    status: 'PENDING_WAITER' | 'PENDING_KITCHEN';
    version: number;
    requestReason: string;
    createdAt: string;
  } | null;
};
type QueuePage = { items: QueueItem[]; page: { limit: number; nextCursor: string | null } };
type QueueState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'denied' }
  | { status: 'expired' }
  | { status: 'ready'; data: QueuePage };
type Props = {
  allowed: boolean;
  canTransition?: boolean;
  canServe?: boolean;
  canCancelNew?: boolean;
  canForwardCancellation?: boolean;
  canDecideCancellation?: boolean;
  onSessionInvalid: () => void;
  csrfToken?: string | null;
  recoverCsrf?: () => Promise<string>;
};

const statusLabels = {
  NEW: 'Mới gửi',
  PREPARING: 'Đang chuẩn bị',
  READY: 'Sẵn sàng',
  SERVED: 'Đã phục vụ',
  CANCELLED: 'Đã hủy · miễn 100%',
};
function itemAction(item: QueueItem) {
  if (item.status === 'READY') return { endpoint: 'mark-served', label: 'Đánh dấu đã phục vụ' };
  if (item.status === 'NEW' && ['KITCHEN', 'BAR'].includes(item.stationSnapshot))
    return { endpoint: 'start-preparation', label: 'Bắt đầu chuẩn bị' };
  if (
    (item.status === 'PREPARING' && ['KITCHEN', 'BAR'].includes(item.stationSnapshot)) ||
    (item.status === 'NEW' && item.stationSnapshot === 'DIRECT')
  )
    return { endpoint: 'mark-ready', label: 'Đánh dấu sẵn sàng' };
  return null;
}

export function KitchenQueue({
  allowed,
  canTransition = false,
  canServe = false,
  canCancelNew = false,
  canForwardCancellation = false,
  canDecideCancellation = false,
  onSessionInvalid,
  csrfToken,
  recoverCsrf,
}: Props) {
  const [state, setState] = useState<QueueState>({ status: 'loading' });
  const [station, setStation] = useState('');
  const [status, setStatus] = useState('NEW');
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [decisionReasons, setDecisionReasons] = useState<Record<string, string>>({});
  const actionInFlight = useRef(false);
  const attempts = useRef(new Map<string, string>());
  const [refreshRevision, setRefreshRevision] = useState(0);
  const inFlight = useRef(false);
  const realtimeDirty = useRef(false);
  const requestController = useRef<AbortController | null>(null);
  const onSessionInvalidRef = useRef(onSessionInvalid);
  useEffect(() => {
    onSessionInvalidRef.current = onSessionInvalid;
  }, [onSessionInvalid]);

  const load = useCallback(
    async (cursor?: string): Promise<void> => {
      if (!allowed || inFlight.current) return;
      inFlight.current = true;
      const controller = new AbortController();
      requestController.current = controller;
      setState({ status: 'loading' });
      try {
        const query = new URLSearchParams({ status, limit: '50' });
        if (station) query.set('station', station);
        if (cursor) query.set('cursor', cursor);
        const response = await fetch(`/api/v1/staff/fulfillment/items?${query}`, {
          credentials: 'include',
          cache: 'no-store',
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (response.status === 401) {
          setState({ status: 'expired' });
          onSessionInvalidRef.current();
          return;
        }
        if (response.status === 403) {
          setState({ status: 'denied' });
          return;
        }
        if (!response.ok) throw new Error('QUEUE_UNAVAILABLE');
        const payload = (await response.json()) as { data: QueuePage };
        if (!controller.signal.aborted) setState({ status: 'ready', data: payload.data });
      } catch {
        if (!controller.signal.aborted) setState({ status: 'error' });
      } finally {
        if (requestController.current === controller) {
          inFlight.current = false;
          requestController.current = null;
          if (realtimeDirty.current) {
            realtimeDirty.current = false;
            setRefreshRevision((value) => value + 1);
          }
        }
      }
    },
    [allowed, station, status],
  );

  const transition = async (item: QueueItem) => {
    const action = itemAction(item);
    if (
      !allowed ||
      !(item.status === 'READY' ? canServe : canTransition) ||
      !action ||
      actionInFlight.current ||
      !csrfToken
    )
      return;
    // Bind retries to the exact item/action/version, even after a refresh or filter change.
    const identity = `${item.id}:${action.endpoint}:${item.version}`;
    const key = attempts.current.get(identity) ?? crypto.randomUUID();
    attempts.current.set(identity, key);
    actionInFlight.current = true;
    setPending(item.id);
    setMessage(null);
    const send = (token: string) =>
      fetch(`/api/v1/staff/fulfillment/items/${encodeURIComponent(item.id)}/${action.endpoint}`, {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': token,
          'Idempotency-Key': key,
        },
        body: JSON.stringify({ expectedVersion: item.version }),
      });
    const readCode = async (response: Response) => {
      const body = (await response.json().catch(() => null)) as {
        error?: { code?: string };
      } | null;
      return body?.error?.code;
    };
    try {
      let response = await send(csrfToken);
      let code = response.ok ? undefined : await readCode(response);
      if (response.status === 403 && code === 'STAFF_CSRF_INVALID' && recoverCsrf) {
        response = await send(await recoverCsrf());
        code = response.ok ? undefined : await readCode(response);
      }
      if (response.status === 401) {
        attempts.current.clear();
        onSessionInvalidRef.current();
        return;
      }
      if (response.ok) {
        attempts.current.delete(identity);
        setMessage('Đã cập nhật món. Đang tải trạng thái từ máy chủ.');
        setState({ status: 'loading' });
        setRefreshRevision((value) => value + 1);
      } else if (response.status === 409) {
        attempts.current.delete(identity);
        setMessage(
          'Trạng thái món hoặc lần thao tác đã thay đổi. Đã yêu cầu tải lại; hãy kiểm tra trước khi thao tác tiếp.',
        );
        setState({ status: 'loading' });
        setRefreshRevision((value) => value + 1);
      } else {
        if (
          response.status < 500 &&
          ![408, 429].includes(response.status) &&
          code !== 'STAFF_CSRF_INVALID'
        )
          attempts.current.delete(identity);
        setMessage(
          response.status === 403 && code !== 'STAFF_CSRF_INVALID'
            ? 'Bạn không còn quyền thực hiện thao tác này. Hãy làm mới hàng chờ.'
            : 'Chưa thể xác nhận thao tác. Hãy thử lại để tiếp tục cùng lần thao tác.',
        );
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'STAFF_SESSION_INVALID') {
        attempts.current.clear();
        onSessionInvalidRef.current();
      } else {
        setMessage('Kết nối bị gián đoạn. Thử lại sẽ tiếp tục cùng lần thao tác.');
      }
    } finally {
      actionInFlight.current = false;
      setPending(null);
    }
  };

  const cancellationCommand = async (
    item: QueueItem,
    command:
      | { kind: 'DIRECT_REJECT'; reasonKey: string }
      | {
          kind:
            | 'WAITER_ACCEPT'
            | 'WAITER_REJECT'
            | 'FORWARD'
            | 'OPERATIONAL_ACCEPT'
            | 'OPERATIONAL_REJECT';
          reasonKey: string;
          request: NonNullable<QueueItem['cancellationRequest']>;
        },
  ) => {
    if (actionInFlight.current || !csrfToken) return;
    const reason = decisionReasons[command.reasonKey]?.trim() ?? '';
    if (!reason) {
      setMessage('Vui lòng nhập lý do trước khi xử lý yêu cầu.');
      return;
    }
    const request = command.kind === 'DIRECT_REJECT' ? null : command.request;
    const endpoint =
      command.kind === 'DIRECT_REJECT'
        ? `/api/v1/staff/fulfillment/items/${encodeURIComponent(item.id)}/reject`
        : command.kind === 'FORWARD'
          ? `/api/v1/staff/cancellation-requests/${encodeURIComponent(request!.id)}/forward-to-kitchen`
          : command.kind.startsWith('WAITER_')
            ? `/api/v1/staff/cancellation-requests/${encodeURIComponent(request!.id)}/waiter-decision`
            : `/api/v1/staff/cancellation-requests/${encodeURIComponent(request!.id)}/operational-decision`;
    const version = request?.version ?? item.version;
    const identity = `${command.kind}:${request?.id ?? item.id}:${version}:${reason}`;
    const key = attempts.current.get(identity) ?? crypto.randomUUID();
    attempts.current.set(identity, key);
    actionInFlight.current = true;
    setPending(item.id);
    setMessage(null);
    const send = (token: string) =>
      fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': token,
          'Idempotency-Key': key,
        },
        body: JSON.stringify({
          expectedVersion: version,
          reason,
          ...(command.kind.includes('ACCEPT')
            ? { decision: 'ACCEPT' }
            : command.kind.includes('REJECT') && command.kind !== 'DIRECT_REJECT'
              ? { decision: 'REJECT' }
              : {}),
        }),
      });
    const readCode = async (response: Response) => {
      const body = (await response.json().catch(() => null)) as {
        error?: { code?: string };
      } | null;
      return body?.error?.code;
    };
    try {
      let response = await send(csrfToken);
      let code = response.ok ? undefined : await readCode(response);
      if (response.status === 403 && code === 'STAFF_CSRF_INVALID' && recoverCsrf) {
        response = await send(await recoverCsrf());
        code = response.ok ? undefined : await readCode(response);
      }
      if (response.status === 401) {
        attempts.current.clear();
        onSessionInvalidRef.current();
        return;
      }
      if (response.ok) {
        attempts.current.delete(identity);
        setDecisionReasons((current) => ({ ...current, [command.reasonKey]: '' }));
        setMessage('Đã ghi nhận quyết định. Đang tải trạng thái authoritative từ máy chủ.');
        setState({ status: 'loading' });
        setRefreshRevision((value) => value + 1);
      } else if (response.status === 409) {
        attempts.current.delete(identity);
        setMessage('Yêu cầu hoặc món đã thay đổi. Dữ liệu mới nhất đang được tải lại.');
        setState({ status: 'loading' });
        setRefreshRevision((value) => value + 1);
      } else {
        if (
          response.status < 500 &&
          ![408, 429].includes(response.status) &&
          code !== 'STAFF_CSRF_INVALID'
        )
          attempts.current.delete(identity);
        setMessage(
          response.status === 403 && code !== 'STAFF_CSRF_INVALID'
            ? 'Bạn không còn quyền xử lý yêu cầu này.'
            : 'Chưa thể xác nhận quyết định. Thử lại sẽ dùng cùng Idempotency-Key.',
        );
      }
    } catch {
      setMessage('Kết nối bị gián đoạn. Thử lại sẽ dùng cùng Idempotency-Key.');
    } finally {
      actionInFlight.current = false;
      setPending(null);
    }
  };

  const realtime = useRealtime({
    actor: 'staff',
    audience: 'kitchen',
    enabled: allowed,
    csrfToken,
    ...(recoverCsrf ? { recoverCsrf } : {}),
    onInvalidate: async () => {
      if (inFlight.current) {
        realtimeDirty.current = true;
        return;
      }
      await load();
    },
  });

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => {
      window.clearTimeout(timeout);
      requestController.current?.abort();
      requestController.current = null;
      inFlight.current = false;
    };
  }, [load, refreshRevision]);

  if (!allowed) return <p role="status">Bạn không có quyền xem hàng chờ bếp.</p>;
  const loading = state.status === 'loading';
  return (
    <section
      className="activation-queue kitchen-queue"
      aria-labelledby="kitchen-queue-heading"
      aria-busy={loading}
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">Kitchen · Bar · Direct</p>
          <h2 id="kitchen-queue-heading">Hàng chờ phục vụ</h2>
          <p>Theo dõi món mới, đang chuẩn bị, sẵn sàng và đã phục vụ</p>
        </div>
        <div className="kitchen-queue-actions">
          <label>
            Trạng thái món
            <select
              value={status}
              disabled={loading || pending !== null}
              onChange={(event) => {
                setState({ status: 'loading' });
                setStatus(event.target.value);
              }}
            >
              <option value="NEW">Mới gửi</option>
              <option value="PREPARING">Đang chuẩn bị</option>
              <option value="READY">Sẵn sàng</option>
              <option value="SERVED">Đã phục vụ</option>
              <option value="CANCELLED">Đã hủy</option>
            </select>
          </label>
          <label>
            Trạm phục vụ
            <select
              value={station}
              disabled={loading || pending !== null}
              onChange={(event) => {
                setState({ status: 'loading' });
                setStation(event.target.value);
              }}
            >
              <option value="">Tất cả trạm</option>
              <option value="KITCHEN">Kitchen</option>
              <option value="BAR">Bar</option>
              <option value="DIRECT">Direct</option>
            </select>
          </label>
          <button
            className="secondary-button"
            type="button"
            disabled={loading}
            onClick={() => void load()}
          >
            Làm mới hàng chờ
          </button>
        </div>
      </div>
      {loading ? <p role="status">Đang tải hàng chờ bếp…</p> : null}
      <RealtimeNotice {...realtime} />
      {message ? (
        <p role="status" className="queue-notice">
          {message}
        </p>
      ) : null}
      {state.status === 'error' ? (
        <p role="alert">Chưa thể tải hàng chờ. Hãy kiểm tra kết nối và làm mới.</p>
      ) : null}
      {state.status === 'denied' ? <p role="alert">Bạn không còn quyền xem hàng chờ bếp.</p> : null}
      {state.status === 'expired' ? (
        <p role="alert">Phiên nhân viên đã hết hạn. Hãy đăng nhập lại.</p>
      ) : null}
      {state.status === 'ready' ? (
        <>
          {state.data.items.length === 0 ? (
            <p role="status">Chưa có món ở trạng thái này tại trạm đã chọn.</p>
          ) : (
            <ul className="kitchen-items">
              {state.data.items.map((item) => (
                <li key={item.id}>
                  <div className="kitchen-item-heading">
                    <h3>
                      Bàn {item.table.code} · {item.nameSnapshot}
                    </h3>
                    <strong>× {item.quantity}</strong>
                  </div>
                  <p>
                    {item.stationSnapshot} · {statusLabels[item.status]}
                  </p>
                  <p>
                    {item.order.source === 'QR_GUEST' ? 'Khách gửi' : 'Nhân viên nhập'} ·{' '}
                    <time dateTime={item.order.submittedAt}>
                      {new Date(item.order.submittedAt).toLocaleString('vi-VN')}
                    </time>
                  </p>
                  <p className="kitchen-order-reference">Order: {item.order.orderNumber}</p>
                  {item.note ? <p className="kitchen-item-note">Ghi chú: {item.note}</p> : null}
                  {item.cancellationRequest ? (
                    <div className="decision-panel">
                      <p>
                        <strong>
                          {item.cancellationRequest.status === 'PENDING_WAITER'
                            ? 'Khách yêu cầu hủy · chờ Waiter'
                            : 'Khách yêu cầu hủy · chờ Kitchen/Bar'}
                        </strong>
                      </p>
                      <p>Lý do khách: {item.cancellationRequest.requestReason}</p>
                      {(item.cancellationRequest.status === 'PENDING_WAITER' &&
                        (canCancelNew ||
                          (item.status === 'PREPARING' && canForwardCancellation))) ||
                      (item.cancellationRequest.status === 'PENDING_KITCHEN' &&
                        canDecideCancellation) ? (
                        <>
                          <label htmlFor={`decision-reason-${item.cancellationRequest.id}`}>
                            Lý do quyết định
                          </label>
                          <input
                            id={`decision-reason-${item.cancellationRequest.id}`}
                            maxLength={500}
                            value={decisionReasons[`request:${item.cancellationRequest.id}`] ?? ''}
                            onChange={(event) =>
                              setDecisionReasons((current) => ({
                                ...current,
                                [`request:${item.cancellationRequest!.id}`]: event.target.value,
                              }))
                            }
                          />
                        </>
                      ) : null}
                      <div className="kitchen-queue-actions">
                        {item.cancellationRequest.status === 'PENDING_WAITER' &&
                        item.status === 'NEW' &&
                        canCancelNew ? (
                          <button
                            className="danger-button"
                            disabled={pending !== null || !csrfToken}
                            type="button"
                            onClick={() =>
                              void cancellationCommand(item, {
                                kind: 'WAITER_ACCEPT',
                                reasonKey: `request:${item.cancellationRequest!.id}`,
                                request: item.cancellationRequest!,
                              })
                            }
                          >
                            Chấp nhận hủy và miễn 100%
                          </button>
                        ) : null}
                        {item.cancellationRequest.status === 'PENDING_WAITER' &&
                        item.status === 'PREPARING' &&
                        canForwardCancellation ? (
                          <button
                            className="primary-button"
                            disabled={pending !== null || !csrfToken}
                            type="button"
                            onClick={() =>
                              void cancellationCommand(item, {
                                kind: 'FORWARD',
                                reasonKey: `request:${item.cancellationRequest!.id}`,
                                request: item.cancellationRequest!,
                              })
                            }
                          >
                            Chuyển Kitchen/Bar quyết định
                          </button>
                        ) : null}
                        {item.cancellationRequest.status === 'PENDING_WAITER' && canCancelNew ? (
                          <button
                            className="secondary-button"
                            disabled={pending !== null || !csrfToken}
                            type="button"
                            onClick={() =>
                              void cancellationCommand(item, {
                                kind: 'WAITER_REJECT',
                                reasonKey: `request:${item.cancellationRequest!.id}`,
                                request: item.cancellationRequest!,
                              })
                            }
                          >
                            Từ chối yêu cầu
                          </button>
                        ) : null}
                        {item.cancellationRequest.status === 'PENDING_KITCHEN' &&
                        canDecideCancellation ? (
                          <>
                            <button
                              className="danger-button"
                              disabled={pending !== null || !csrfToken}
                              type="button"
                              onClick={() =>
                                void cancellationCommand(item, {
                                  kind: 'OPERATIONAL_ACCEPT',
                                  reasonKey: `request:${item.cancellationRequest!.id}`,
                                  request: item.cancellationRequest!,
                                })
                              }
                            >
                              Có thể dừng · miễn 100%
                            </button>
                            <button
                              className="secondary-button"
                              disabled={pending !== null || !csrfToken}
                              type="button"
                              onClick={() =>
                                void cancellationCommand(item, {
                                  kind: 'OPERATIONAL_REJECT',
                                  reasonKey: `request:${item.cancellationRequest!.id}`,
                                  request: item.cancellationRequest!,
                                })
                              }
                            >
                              Không thể dừng
                            </button>
                          </>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                  {!item.cancellationRequest &&
                  item.status === 'NEW' &&
                  ['KITCHEN', 'BAR'].includes(item.stationSnapshot) &&
                  canDecideCancellation ? (
                    <div className="rejection-form">
                      <label htmlFor={`direct-reject-${item.id}`}>Lý do từ chối món</label>
                      <input
                        id={`direct-reject-${item.id}`}
                        maxLength={500}
                        value={decisionReasons[`direct:${item.id}:${item.version}`] ?? ''}
                        onChange={(event) =>
                          setDecisionReasons((current) => ({
                            ...current,
                            [`direct:${item.id}:${item.version}`]: event.target.value,
                          }))
                        }
                      />
                      <button
                        className="danger-button"
                        disabled={pending !== null || !csrfToken}
                        type="button"
                        onClick={() =>
                          void cancellationCommand(item, {
                            kind: 'DIRECT_REJECT',
                            reasonKey: `direct:${item.id}:${item.version}`,
                          })
                        }
                      >
                        Từ chối món · miễn 100%
                      </button>
                    </div>
                  ) : null}
                  {(item.status === 'READY' ? canServe : canTransition) && itemAction(item) ? (
                    <button
                      type="button"
                      className="primary-button"
                      disabled={pending !== null || !csrfToken}
                      onClick={() => void transition(item)}
                    >
                      {pending === item.id ? 'Đang cập nhật…' : itemAction(item)!.label}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {state.data.page.nextCursor ? (
            <button
              className="secondary-button"
              type="button"
              onClick={() => void load(state.data.page.nextCursor!)}
            >
              Trang tiếp theo
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
