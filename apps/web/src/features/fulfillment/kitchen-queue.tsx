'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type QueueItem = {
  id: string;
  nameSnapshot: string;
  quantity: number;
  note: string | null;
  stationSnapshot: 'KITCHEN' | 'BAR' | 'DIRECT';
  status: 'NEW';
  order: {
    id: string;
    orderNumber: string;
    source: 'QR_GUEST' | 'STAFF_WAITER';
    submittedAt: string;
  };
  table: { code: string };
};
type QueuePage = { items: QueueItem[]; page: { limit: number; nextCursor: string | null } };
type QueueState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'denied' }
  | { status: 'expired' }
  | { status: 'ready'; data: QueuePage };
type Props = { allowed: boolean; onSessionInvalid: () => void };

export function KitchenQueue({ allowed, onSessionInvalid }: Props) {
  const [state, setState] = useState<QueueState>({ status: 'loading' });
  const [station, setStation] = useState('');
  const inFlight = useRef(false);
  const requestController = useRef<AbortController | null>(null);
  const onSessionInvalidRef = useRef(onSessionInvalid);
  useEffect(() => {
    onSessionInvalidRef.current = onSessionInvalid;
  }, [onSessionInvalid]);

  const load = useCallback(
    async (cursor?: string) => {
      if (!allowed || inFlight.current) return;
      inFlight.current = true;
      const controller = new AbortController();
      requestController.current = controller;
      setState({ status: 'loading' });
      try {
        const query = new URLSearchParams({ status: 'NEW', limit: '50' });
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
        }
      }
    },
    [allowed, station],
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => {
      window.clearTimeout(timeout);
      requestController.current?.abort();
      requestController.current = null;
      inFlight.current = false;
    };
  }, [load]);

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
          <p>Danh sách món mới đã gửi · Chỉ xem</p>
        </div>
        <div className="kitchen-queue-actions">
          <label>
            Trạm phục vụ
            <select
              value={station}
              disabled={loading}
              onChange={(event) => setStation(event.target.value)}
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
            <p role="status">Chưa có món mới đang chờ tại trạm này.</p>
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
                  <p>{item.stationSnapshot} · Mới gửi</p>
                  <p>
                    {item.order.source === 'QR_GUEST' ? 'Khách gửi' : 'Nhân viên nhập'} ·{' '}
                    <time dateTime={item.order.submittedAt}>
                      {new Date(item.order.submittedAt).toLocaleString('vi-VN')}
                    </time>
                  </p>
                  <p className="kitchen-order-reference">Order: {item.order.orderNumber}</p>
                  {item.note ? <p className="kitchen-item-note">Ghi chú: {item.note}</p> : null}
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
