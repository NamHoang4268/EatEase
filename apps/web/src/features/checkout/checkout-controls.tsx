'use client';

import { useRef, useState } from 'react';

type Props = {
  actor: 'guest' | 'staff';
  session: { id: string; status: 'ACTIVE' | 'CHECKOUT_LOCKED'; version: number };
  bill: { status: string; version: number };
  csrfToken: string | null;
  recoverCsrf: () => Promise<string>;
  refresh: () => Promise<void>;
  onSessionInvalid: () => void;
};

export function CheckoutControls({
  actor,
  session,
  bill,
  csrfToken,
  recoverCsrf,
  refresh,
  onSessionInvalid,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);
  const attempt = useRef<{ target: string; key: string; body: string } | null>(null);
  const locked = session.status === 'CHECKOUT_LOCKED';
  const canAct = locked
    ? actor === 'staff' && bill.status === 'PAYMENT_PENDING'
    : bill.status === 'OPEN';

  const run = async () => {
    if (inFlight.current || !canAct) return;
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    const action = locked ? 'resume-ordering' : 'checkout';
    const target =
      actor === 'guest'
        ? '/api/v1/table-sessions/current/checkout'
        : `/api/v1/staff/table-sessions/${encodeURIComponent(session.id)}/${action}`;
    const identity = `${session.id}:${target}`;
    // Reuse the original versions and key after ambiguous outcomes, even following a realtime refetch.
    const current =
      attempt.current?.target === identity
        ? attempt.current
        : {
            target: identity,
            key: crypto.randomUUID(),
            body: JSON.stringify({
              expectedSessionVersion: session.version,
              expectedBillVersion: bill.version,
            }),
          };
    attempt.current = current;
    const send = (token: string) =>
      fetch(target, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': token,
          'Idempotency-Key': current.key,
        },
        body: current.body,
      });
    try {
      let response = await send(csrfToken ?? (await recoverCsrf()));
      let error = response.ok
        ? null
        : ((await response.json().catch(() => null)) as { error?: { code?: string } } | null);
      if (
        response.status === 403 &&
        error?.error?.code === (actor === 'guest' ? 'GUEST_CSRF_INVALID' : 'STAFF_CSRF_INVALID')
      ) {
        response = await send(await recoverCsrf());
        error = response.ok
          ? null
          : ((await response.json().catch(() => null)) as { error?: { code?: string } } | null);
      }
      if (response.status === 401) {
        onSessionInvalid();
        return;
      }
      if (!response.ok) {
        if (response.status < 500) attempt.current = null;
        if (response.status === 409) {
          await refresh();
          setMessage(
            error?.error?.code === 'CHECKOUT_ITEMS_NOT_TERMINAL' ||
              error?.error?.code === 'CHECKOUT_CANCELLATION_PENDING'
              ? 'Chưa thể thanh toán: còn món chưa hoàn tất hoặc yêu cầu hủy đang chờ xử lý.'
              : error?.error?.code === 'CHECKOUT_EMPTY_SESSION'
                ? 'Phiên bàn chưa có lịch sử gọi món để thanh toán.'
                : 'Trạng thái hoặc phiên bản hóa đơn đã thay đổi. Hãy kiểm tra dữ liệu vừa cập nhật.',
          );
        } else setMessage('Chưa thể xử lý yêu cầu. Bạn có thể thử lại.');
        return;
      }
      attempt.current = null;
      await refresh();
      setMessage(locked ? 'Đã mở lại gọi món.' : 'Đã khóa gọi món để chờ thanh toán.');
    } catch {
      setMessage('Kết nối bị gián đoạn. Thử lại sẽ dùng cùng mã yêu cầu.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="checkout-controls">
      <p>
        {locked
          ? 'Đang chờ thanh toán. Gọi món đã khóa; nhân viên có thể mở lại khi chưa thanh toán.'
          : 'Đang mở gọi món.'}
      </p>
      {canAct ? (
        <button
          type="button"
          className="secondary-button"
          disabled={busy || !csrfToken}
          onClick={() => void run()}
        >
          {busy ? 'Đang xử lý…' : locked ? 'Mở lại gọi món' : 'Yêu cầu thanh toán'}
        </button>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
    </div>
  );
}
