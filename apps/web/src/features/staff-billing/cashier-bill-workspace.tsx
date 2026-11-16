'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatVnd } from '../public-menu/draft-cart';
import type { ConsolidatedSessionView } from '../public-menu/public-menu.types';
import { RealtimeNotice } from '../realtime/realtime-notice';
import { useRealtime } from '../realtime/use-realtime';
import type { StaffActiveTableSession } from '../staff-activation/staff-activation.types';

type Props = {
  allowed: boolean;
  canRecordCash: boolean;
  sessions: StaffActiveTableSession[];
  csrfToken: string | null;
  recoverCsrf: () => Promise<string>;
  onSessionInvalid: () => void;
};

type BillState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; view: ConsolidatedSessionView }
  | { status: 'error'; kind: 'denied' | 'unavailable' | 'server'; message: string };

type CashPaymentAttempt = {
  sessionId: string;
  key: string;
  body: string;
  uncertain: boolean;
};

type CashPaymentResponse = {
  data: {
    session: { id: string; status: 'CHECKOUT_LOCKED'; version: number };
    bill: {
      id: string;
      status: 'SETTLED';
      version: number;
      totalAmount: string;
      paidAmount: string;
      balanceAmount: string;
    };
    payment: {
      id: string;
      method: 'CASH';
      status: 'SUCCEEDED';
      amount: string;
      recordedAt: string;
    } | null;
    settlement: { id: string; settledAmount: string; settledAt: string };
  };
};

async function readErrorCode(response: Response): Promise<string | undefined> {
  try {
    const payload = (await response.json()) as { error?: { code?: string } };
    return payload.error?.code;
  } catch {
    return undefined;
  }
}

function sessionStatusLabel(status: StaffActiveTableSession['status']): string {
  return status === 'CHECKOUT_LOCKED' ? 'Đã khóa gọi món' : 'Đang gọi món';
}

function billStatusLabel(status: string): string {
  if (status === 'PAYMENT_PENDING') return 'Chờ thanh toán';
  if (status === 'OPEN') return 'Đang mở';
  if (status === 'SETTLED') return 'Đã tất toán (SETTLED)';
  return status;
}

export function CashierBillWorkspace({
  allowed,
  canRecordCash,
  sessions,
  csrfToken,
  recoverCsrf,
  onSessionInvalid,
}: Props) {
  const [selectedId, setSelectedId] = useState('');
  const [billState, setBillState] = useState<BillState>({ status: 'idle' });
  const selectedIdRef = useRef(selectedId);
  const requestSequence = useRef(0);
  const cashPaymentInFlight = useRef(false);
  const cashPaymentAttempts = useRef(new Map<string, CashPaymentAttempt>());
  const [confirmingCashPayment, setConfirmingCashPayment] = useState(false);
  const [cashPaymentBusy, setCashPaymentBusy] = useState(false);
  const [cashPaymentUncertain, setCashPaymentUncertain] = useState(false);
  const [cashPaymentNotice, setCashPaymentNotice] = useState<string | null>(null);

  const eligibleSessions = useMemo(
    () =>
      [...sessions]
        .filter((session) => session.status === 'ACTIVE' || session.status === 'CHECKOUT_LOCKED')
        .sort((left, right) => {
          const statusOrder =
            Number(right.status === 'CHECKOUT_LOCKED') - Number(left.status === 'CHECKOUT_LOCKED');
          return statusOrder || left.table.code.localeCompare(right.table.code, 'vi');
        }),
    [sessions],
  );
  const selected = eligibleSessions.find((session) => session.id === selectedId) ?? null;

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const loadBill = useCallback(
    async (sessionId: string) => {
      const sequence = ++requestSequence.current;
      setBillState({ status: 'loading' });
      try {
        const response = await fetch(
          `/api/v1/staff/table-sessions/${encodeURIComponent(sessionId)}/bill`,
          { credentials: 'include', cache: 'no-store' },
        );
        if (sequence !== requestSequence.current || selectedIdRef.current !== sessionId) return;
        if (response.status === 401) {
          onSessionInvalid();
          return;
        }
        if (response.status === 403) {
          setBillState({
            status: 'error',
            kind: 'denied',
            message: 'Bạn không còn quyền xem hóa đơn tại địa điểm này.',
          });
          return;
        }
        if (response.status === 404 || response.status === 409) {
          setBillState({
            status: 'error',
            kind: 'unavailable',
            message: 'Phiên bàn đã thay đổi hoặc không còn khả dụng. Hãy làm mới danh sách bàn.',
          });
          return;
        }
        if (!response.ok) throw new Error('BILL_READ_FAILED');
        const payload = (await response.json()) as { data: ConsolidatedSessionView };
        if (sequence === requestSequence.current && selectedIdRef.current === sessionId) {
          setBillState({ status: 'ready', view: payload.data });
        }
      } catch {
        if (sequence === requestSequence.current && selectedIdRef.current === sessionId) {
          setBillState({
            status: 'error',
            kind: 'server',
            message: 'Chưa thể tải hóa đơn. Kiểm tra kết nối rồi thử lại.',
          });
        }
      }
    },
    [onSessionInvalid],
  );

  useEffect(() => {
    if (!selected) return;
    const timeout = window.setTimeout(() => void loadBill(selected.id), 0);
    return () => window.clearTimeout(timeout);
  }, [loadBill, selected]);

  useEffect(
    () => () => {
      requestSequence.current += 1;
    },
    [],
  );

  const realtime = useRealtime({
    actor: 'staff',
    audience: 'bill',
    csrfToken,
    recoverCsrf,
    enabled: allowed && Boolean(selected),
    ...(selected ? { tableSessionId: selected.id } : {}),
    onInvalidate: async () => {
      const currentId = selectedIdRef.current;
      if (currentId) await loadBill(currentId);
    },
  });

  const settleWithCash = async (view: ConsolidatedSessionView) => {
    if (cashPaymentInFlight.current) return;
    const sessionId = view.session.id;
    const currentAttempt = cashPaymentAttempts.current.get(sessionId);
    const attempt =
      currentAttempt?.sessionId === sessionId
        ? currentAttempt
        : {
            sessionId,
            key: crypto.randomUUID(),
            body: JSON.stringify({
              expectedSessionVersion: view.session.version,
              expectedBillVersion: view.bill.version,
            }),
            uncertain: false,
          };
    cashPaymentAttempts.current.set(sessionId, attempt);
    cashPaymentInFlight.current = true;
    setCashPaymentBusy(true);
    setCashPaymentNotice(null);

    const send = (token: string) =>
      fetch(`/api/v1/staff/table-sessions/${encodeURIComponent(sessionId)}/cash-payment`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': attempt.key,
          'X-CSRF-Token': token,
        },
        body: attempt.body,
      });

    try {
      let response = await send(csrfToken ?? (await recoverCsrf()));
      let errorCode = response.ok ? undefined : await readErrorCode(response);
      if (response.status === 403 && errorCode === 'STAFF_CSRF_INVALID') {
        response = await send(await recoverCsrf());
        errorCode = response.ok ? undefined : await readErrorCode(response);
      }
      if (response.status === 401) {
        cashPaymentAttempts.current.delete(sessionId);
        onSessionInvalid();
        return;
      }
      if (!response.ok) {
        const isCurrentSelection = selectedIdRef.current === sessionId;
        if (response.status === 409) {
          cashPaymentAttempts.current.delete(sessionId);
          if (isCurrentSelection) {
            setCashPaymentUncertain(false);
            setConfirmingCashPayment(false);
            await loadBill(sessionId);
            if (selectedIdRef.current === sessionId)
              setCashPaymentNotice(
                'Phiên bàn hoặc hóa đơn đã thay đổi. Hãy kiểm tra dữ liệu mới trước khi xác nhận lại.',
              );
          }
        } else if (response.status >= 500) {
          cashPaymentAttempts.current.set(sessionId, { ...attempt, uncertain: true });
          if (isCurrentSelection) {
            setCashPaymentUncertain(true);
            setCashPaymentNotice(
              'Chưa xác định được kết quả thanh toán. Hãy thử lại cùng mã yêu cầu; không tạo thao tác mới.',
            );
          }
        } else {
          cashPaymentAttempts.current.delete(sessionId);
          if (isCurrentSelection) {
            setCashPaymentUncertain(false);
            setCashPaymentNotice(
              response.status === 403
                ? 'Bạn không còn quyền ghi nhận thanh toán tiền mặt tại địa điểm này.'
                : `Không thể ghi nhận thanh toán${errorCode ? ` (${errorCode})` : ''}. Hãy kiểm tra lại dữ liệu.`,
            );
          }
        }
        return;
      }

      const payload = (await response.json()) as CashPaymentResponse;
      cashPaymentAttempts.current.delete(sessionId);
      if (selectedIdRef.current === sessionId) {
        setCashPaymentUncertain(false);
        setConfirmingCashPayment(false);
        setCashPaymentNotice(
          payload.data.payment
            ? `Đã ghi nhận tiền mặt ${formatVnd(BigInt(payload.data.payment.amount))} và tất toán hóa đơn. Phiên bàn vẫn đang khóa.`
            : 'Đã tất toán hóa đơn có số dư 0 ₫, không tạo bản ghi thu tiền mặt. Phiên bàn vẫn đang khóa.',
        );
        await loadBill(sessionId);
      }
    } catch {
      cashPaymentAttempts.current.set(sessionId, { ...attempt, uncertain: true });
      if (selectedIdRef.current === sessionId) {
        setCashPaymentUncertain(true);
        setCashPaymentNotice(
          'Kết nối bị gián đoạn và kết quả chưa chắc chắn. Thử lại sẽ dùng đúng mã yêu cầu và phiên bản ban đầu.',
        );
      }
    } finally {
      cashPaymentInFlight.current = false;
      setCashPaymentBusy(false);
    }
  };

  if (!allowed) return null;

  const view = billState.status === 'ready' ? billState.view : null;

  return (
    <section className="activation-queue cashier-workspace" aria-labelledby="cashier-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Cashier workspace</p>
          <h2 id="cashier-heading">Hóa đơn theo bàn</h2>
          <p>REST là dữ liệu chính thức; realtime chỉ báo hiệu để tải lại.</p>
        </div>
        {eligibleSessions.length > 0 ? (
          <label>
            Hóa đơn theo phiên bàn
            <select
              value={selectedId}
              onChange={(event) => {
                requestSequence.current += 1;
                const uncertainAttempt = cashPaymentAttempts.current.get(event.target.value);
                setSelectedId(event.target.value);
                setBillState({ status: 'idle' });
                setConfirmingCashPayment(Boolean(uncertainAttempt?.uncertain));
                setCashPaymentUncertain(Boolean(uncertainAttempt?.uncertain));
                setCashPaymentNotice(null);
              }}
            >
              <option value="">Chọn phiên bàn</option>
              {eligibleSessions.map((session) => (
                <option key={session.id} value={session.id}>
                  Bàn {session.table.code} · {sessionStatusLabel(session.status)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <RealtimeNotice {...realtime} />
      {cashPaymentNotice ? (
        <p className="queue-notice" role="status">
          {cashPaymentNotice}
        </p>
      ) : null}

      {eligibleSessions.length === 0 ? (
        <div className="operational-state">
          <h3>Không có hóa đơn đang hoạt động</h3>
          <p>Workspace chỉ hiển thị phiên ACTIVE hoặc CHECKOUT_LOCKED trong địa điểm hiện tại.</p>
        </div>
      ) : !selected ? (
        <div className="operational-state">
          <h3>Chọn một phiên bàn</h3>
          <p>Các phiên đã khóa gọi món được ưu tiên ở đầu danh sách.</p>
        </div>
      ) : billState.status === 'loading' ? (
        <div className="operational-state" aria-busy="true">
          <p>Đang tải hóa đơn bàn {selected.table.code}…</p>
        </div>
      ) : billState.status === 'error' ? (
        <div className="operational-state operational-error" role="alert">
          <h3>
            {billState.kind === 'denied'
              ? 'Không có quyền truy cập'
              : billState.kind === 'unavailable'
                ? 'Phiên bàn không còn khả dụng'
                : 'Chưa thể tải hóa đơn'}
          </h3>
          <p>{billState.message}</p>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void loadBill(selected.id)}
          >
            Thử lại
          </button>
        </div>
      ) : view ? (
        <div className="cashier-bill">
          <div className="cashier-bill-heading">
            <div>
              <p className="eyebrow">Bàn {view.session.table.code}</p>
              <h3>{billStatusLabel(view.bill.status)}</h3>
            </div>
            <button
              className="secondary-button"
              type="button"
              onClick={() => void loadBill(selected.id)}
            >
              Cập nhật
            </button>
          </div>

          {canRecordCash &&
          view.session.status === 'CHECKOUT_LOCKED' &&
          view.bill.status === 'PAYMENT_PENDING' ? (
            <div className="cash-payment-action">
              {!confirmingCashPayment ? (
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => setConfirmingCashPayment(true)}
                >
                  Ghi nhận thanh toán tiền mặt
                </button>
              ) : (
                <div
                  className="cash-payment-confirmation"
                  role="group"
                  aria-label="Xác nhận thanh toán"
                >
                  <div>
                    <p className="eyebrow">Xác nhận một lần</p>
                    <h4>Bàn {view.session.table.code}</h4>
                    {BigInt(view.bill.balanceAmount) > 0n ? (
                      <p>
                        Xác nhận đã nhận đủ{' '}
                        <strong>{formatVnd(BigInt(view.bill.balanceAmount))}</strong> tiền mặt.
                      </p>
                    ) : (
                      <p>
                        Hóa đơn có số dư <strong>0 ₫</strong>. Thao tác chỉ tạo Settlement, không
                        ghi nhận tiền mặt giả.
                      </p>
                    )}
                    <p>
                      Hóa đơn sẽ được tất toán. Phiên bàn vẫn CHECKOUT_LOCKED và bàn chưa được giải
                      phóng hoặc đánh dấu sẵn sàng.
                    </p>
                  </div>
                  <div className="staff-header-actions">
                    <button
                      className="primary-button"
                      type="button"
                      disabled={cashPaymentBusy}
                      onClick={() => void settleWithCash(view)}
                    >
                      {cashPaymentBusy
                        ? 'Đang ghi nhận…'
                        : cashPaymentUncertain
                          ? 'Thử lại cùng yêu cầu'
                          : BigInt(view.bill.balanceAmount) > 0n
                            ? 'Xác nhận đã nhận đủ tiền'
                            : 'Xác nhận tất toán số dư 0 ₫'}
                    </button>
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={cashPaymentBusy}
                      onClick={() => {
                        if (cashPaymentUncertain) return;
                        cashPaymentAttempts.current.delete(view.session.id);
                        setConfirmingCashPayment(false);
                      }}
                    >
                      Hủy
                    </button>
                  </div>
                  {cashPaymentUncertain ? (
                    <p className="permission-note">
                      Kết quả trước đó chưa chắc chắn nên không thể hủy thao tác. Hãy thử lại cùng
                      yêu cầu hoặc dùng Cập nhật để kiểm tra trạng thái chính thức.
                    </p>
                  ) : null}
                </div>
              )}
            </div>
          ) : null}

          <dl className="cashier-metadata">
            <div>
              <dt>TableSession</dt>
              <dd>{view.session.id}</dd>
            </div>
            <div>
              <dt>Public table ID</dt>
              <dd>{view.session.table.publicId}</dd>
            </div>
            <div>
              <dt>Trạng thái phiên</dt>
              <dd>{sessionStatusLabel(view.session.status)}</dd>
            </div>
            <div>
              <dt>Phiên bản session</dt>
              <dd>{view.session.version}</dd>
            </div>
            <div>
              <dt>Trạng thái Bill</dt>
              <dd>{billStatusLabel(view.bill.status)}</dd>
            </div>
            <div>
              <dt>Phiên bản Bill</dt>
              <dd>{view.bill.version}</dd>
            </div>
          </dl>

          <div className="cashier-bill-grid">
            <div>
              <h4>Bill lines</h4>
              {view.bill.lines.length > 0 ? (
                <ul className="bill-lines">
                  {view.bill.lines.map((line) => (
                    <li key={line.id}>
                      <span>
                        <strong>{line.descriptionSnapshot}</strong>
                        <small>
                          {line.quantity} × {formatVnd(BigInt(line.unitAmount))}
                        </small>
                      </span>
                      <strong>{formatVnd(BigInt(line.lineAmount))}</strong>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Hóa đơn chưa có món.</p>
              )}

              <h4>Điều chỉnh</h4>
              {view.bill.adjustments.length > 0 ? (
                <ul className="bill-lines cashier-adjustments">
                  {view.bill.adjustments.map((adjustment) => (
                    <li key={adjustment.id}>
                      <span>
                        <strong>{adjustment.reason}</strong>
                        <small>{adjustment.kind}</small>
                      </span>
                      <strong>{formatVnd(BigInt(adjustment.amount))}</strong>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Không có điều chỉnh.</p>
              )}
            </div>

            <dl className="bill-totals cashier-totals">
              <dt>Tạm tính</dt>
              <dd>{formatVnd(BigInt(view.bill.subtotalAmount))}</dd>
              <dt>Điều chỉnh</dt>
              <dd>{formatVnd(BigInt(view.bill.adjustmentAmount))}</dd>
              <dt>Tổng cộng</dt>
              <dd>{formatVnd(BigInt(view.bill.totalAmount))}</dd>
              <dt>Đã thanh toán</dt>
              <dd>{formatVnd(BigInt(view.bill.paidAmount))}</dd>
              <dt>Còn lại</dt>
              <dd>{formatVnd(BigInt(view.bill.balanceAmount))}</dd>
            </dl>
          </div>
        </div>
      ) : null}
    </section>
  );
}
