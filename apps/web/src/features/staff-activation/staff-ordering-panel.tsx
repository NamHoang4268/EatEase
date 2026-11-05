'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addDraftItem,
  calculateDraftSubtotal,
  changeDraftQuantity,
  formatVnd,
  removeDraftItem,
  type DraftCartLine,
} from '../public-menu/draft-cart';
import type {
  ConsolidatedSessionView,
  PublicMenu,
  PublicMenuItem,
} from '../public-menu/public-menu.types';
import type { ApiErrorPayload, StaffActiveTableSession } from './staff-activation.types';
import { useRealtime } from '../realtime/use-realtime';
import { RealtimeNotice } from '../realtime/realtime-notice';

type Props = {
  sessions: StaffActiveTableSession[];
  canSubmit: boolean;
  canReadBill: boolean;
  csrfToken: string | null;
  recoverCsrf: () => Promise<string>;
  onSessionInvalid: () => void;
};

async function readError(response: Response): Promise<ApiErrorPayload | null> {
  try {
    return (await response.json()) as ApiErrorPayload;
  } catch {
    return null;
  }
}

export function StaffOrderingPanel({
  sessions,
  canSubmit,
  canReadBill,
  csrfToken,
  recoverCsrf,
  onSessionInvalid,
}: Props) {
  const [selectedId, setSelectedId] = useState('');
  const selectedIdRef = useRef(selectedId);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);
  const [menu, setMenu] = useState<PublicMenu | null>(null);
  const [cart, setCart] = useState<DraftCartLine[]>([]);
  const [bill, setBill] = useState<ConsolidatedSessionView | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const attemptRef = useRef<{ key: string; payload: string; sessionId: string } | null>(null);
  const selected = sessions.find((session) => session.id === selectedId) ?? null;
  const subtotal = useMemo(() => calculateDraftSubtotal(cart), [cart]);

  const realtime = useRealtime({
    actor: 'staff',
    audience: 'bill',
    csrfToken,
    recoverCsrf,
    enabled: canReadBill && Boolean(selected),
    tableSessionId: selectedId,
    onInvalidate: async () => {
      if (!selected) return;
      try {
        const response = await fetch(
          `/api/v1/staff/table-sessions/${encodeURIComponent(selected.id)}/bill`,
          { credentials: 'include', cache: 'no-store' },
        );
        if (response.status === 401) {
          onSessionInvalid();
          return;
        }
        if (!response.ok) throw new Error();
        const payload = (await response.json()) as { data: ConsolidatedSessionView };
        if (selectedIdRef.current === selected.id) setBill(payload.data);
      } catch {
        setMessage('Chưa thể cập nhật hóa đơn. Hãy tải lại dữ liệu bàn.');
      }
    },
  });

  const loadContext = useCallback(
    async (session: StaffActiveTableSession) => {
      setLoading(true);
      setMessage(null);
      try {
        const requests: Promise<Response>[] = [
          fetch(`/api/v1/public/menu?tablePublicId=${encodeURIComponent(session.table.publicId)}`),
        ];
        if (canReadBill) {
          requests.push(
            fetch(`/api/v1/staff/table-sessions/${encodeURIComponent(session.id)}/bill`, {
              credentials: 'include',
            }),
          );
        }
        const [menuResponse, billResponse] = await Promise.all(requests);
        if (!menuResponse?.ok) throw new Error('MENU_UNAVAILABLE');
        const menuPayload = (await menuResponse.json()) as { data: PublicMenu };
        setMenu(menuPayload.data);
        if (billResponse) {
          if (billResponse.status === 401) {
            onSessionInvalid();
            return;
          }
          if (!billResponse.ok) throw new Error('BILL_UNAVAILABLE');
          const billPayload = (await billResponse.json()) as { data: ConsolidatedSessionView };
          setBill(billPayload.data);
        } else {
          setBill(null);
        }
      } catch {
        setMessage('Chưa thể tải menu hoặc hóa đơn của bàn đã chọn.');
      } finally {
        setLoading(false);
      }
    },
    [canReadBill, onSessionInvalid],
  );

  useEffect(() => {
    if (!selected) return;
    const timeout = window.setTimeout(() => void loadContext(selected), 0);
    return () => window.clearTimeout(timeout);
  }, [loadContext, selected]);

  const addItem = (item: PublicMenuItem) => setCart((current) => addDraftItem(current, item));

  const submit = async () => {
    if (!selected || cart.length === 0 || submitting || !canSubmit) return;
    const payload = JSON.stringify({
      items: cart.map((line) => ({
        menuItemId: line.menuItemId,
        quantity: line.quantity,
        modifierSelections: [],
        note: null,
      })),
    });
    const attempt =
      attemptRef.current?.payload === payload && attemptRef.current.sessionId === selected.id
        ? attemptRef.current
        : { key: crypto.randomUUID(), payload, sessionId: selected.id };
    attemptRef.current = attempt;
    setSubmitting(true);
    setMessage(null);
    const send = (token: string) =>
      fetch(`/api/v1/staff/table-sessions/${encodeURIComponent(selected.id)}/orders`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': attempt.key,
          'X-CSRF-Token': token,
        },
        body: payload,
      });
    try {
      let token = csrfToken ?? (await recoverCsrf());
      let response = await send(token);
      let error = response.ok ? null : await readError(response);
      if (response.status === 403 && error?.error?.code === 'STAFF_CSRF_INVALID') {
        token = await recoverCsrf();
        response = await send(token);
        error = response.ok ? null : await readError(response);
      }
      if (response.status === 401) {
        onSessionInvalid();
        return;
      }
      if (!response.ok) {
        if (response.status < 500) attemptRef.current = null;
        setMessage(
          response.status === 409
            ? 'Trạng thái bàn hoặc lần gửi đã thay đổi. Hãy cập nhật rồi thử lại.'
            : error?.error?.code === 'ORDER_MENU_ITEM_UNAVAILABLE'
              ? 'Một món đã ngừng phục vụ. Hãy tải lại menu.'
              : 'Chưa thể gửi order. Giỏ nhập liệu vẫn được giữ nguyên.',
        );
        return;
      }
      attemptRef.current = null;
      setCart([]);
      setMessage(`Đã gửi order cho bàn ${selected.table.code}.`);
      await loadContext(selected);
    } catch {
      setMessage('Kết nối bị gián đoạn. Thử lại sẽ dùng cùng Idempotency-Key.');
    } finally {
      setSubmitting(false);
    }
  };

  const items = menu?.categories.flatMap((category) => category.items) ?? [];

  return (
    <section className="activation-queue staff-ordering" aria-labelledby="staff-ordering-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Waiter ordering</p>
          <h2 id="staff-ordering-heading">Nhập order tại bàn</h2>
        </div>
        <label>
          Phiên bàn
          <select
            value={selectedId}
            onChange={(event) => {
              setSelectedId(event.target.value);
              setCart([]);
              setMenu(null);
              setBill(null);
              setMessage(null);
              attemptRef.current = null;
            }}
          >
            <option value="">Chọn bàn đang hoạt động</option>
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>
                Bàn {session.table.code}
              </option>
            ))}
          </select>
        </label>
      </div>

      {message ? <p className="queue-notice">{message}</p> : null}
      <RealtimeNotice {...realtime} />
      {loading ? <p>Đang tải dữ liệu bàn…</p> : null}
      {selected && menu ? (
        <div className="staff-ordering-grid">
          <div>
            <h3>Thực đơn</h3>
            <ul className="staff-menu-list">
              {items.map((item) => (
                <li key={item.id}>
                  <span>{item.name}</span>
                  <strong>{formatVnd(BigInt(item.priceAmount))}</strong>
                  <button
                    type="button"
                    disabled={!canSubmit || !item.available}
                    onClick={() => addItem(item)}
                  >
                    Thêm
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3>Order nháp</h3>
            {cart.length === 0 ? (
              <p>Chưa chọn món.</p>
            ) : (
              <ul className="staff-menu-list">
                {cart.map((line) => (
                  <li key={line.menuItemId}>
                    <span>{line.name}</span>
                    <div className="quantity-controls">
                      <button
                        type="button"
                        onClick={() =>
                          setCart((current) => changeDraftQuantity(current, line.menuItemId, -1))
                        }
                      >
                        −
                      </button>
                      <output>{line.quantity}</output>
                      <button
                        type="button"
                        onClick={() =>
                          setCart((current) => changeDraftQuantity(current, line.menuItemId, 1))
                        }
                      >
                        +
                      </button>
                    </div>
                    <button
                      className="text-button"
                      type="button"
                      onClick={() =>
                        setCart((current) => removeDraftItem(current, line.menuItemId))
                      }
                    >
                      Xóa
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="cart-summary">
              <span>Tạm tính</span>
              <strong>{formatVnd(subtotal)}</strong>
              <button
                className="primary-button"
                disabled={!canSubmit || cart.length === 0 || submitting}
                type="button"
                onClick={() => void submit()}
              >
                {submitting ? 'Đang gửi…' : 'Gửi order'}
              </button>
            </div>
          </div>
          {canReadBill ? (
            <div>
              <h3>Hóa đơn tổng hợp</h3>
              {bill?.bill.lines.length ? (
                <ul className="bill-lines">
                  {bill.bill.lines.map((line) => (
                    <li key={line.id}>
                      <span>
                        {line.descriptionSnapshot} × {line.quantity}
                      </span>
                      <strong>{formatVnd(BigInt(line.lineAmount))}</strong>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Hóa đơn chưa có món.</p>
              )}
              {bill ? (
                <div className="bill-totals">
                  <span>Tổng cộng</span>
                  <strong>{formatVnd(BigInt(bill.bill.totalAmount))}</strong>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
