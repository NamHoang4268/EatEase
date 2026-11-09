'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatVnd } from '../public-menu/draft-cart';
import type { ConsolidatedSessionView } from '../public-menu/public-menu.types';
import { RealtimeNotice } from '../realtime/realtime-notice';
import { useRealtime } from '../realtime/use-realtime';
import type { StaffActiveTableSession } from '../staff-activation/staff-activation.types';

type Props = {
  allowed: boolean;
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

function sessionStatusLabel(status: StaffActiveTableSession['status']): string {
  return status === 'CHECKOUT_LOCKED' ? 'Chờ thanh toán' : 'Đang gọi món';
}

function billStatusLabel(status: string): string {
  if (status === 'PAYMENT_PENDING') return 'Chờ thanh toán';
  if (status === 'OPEN') return 'Đang mở';
  return status;
}

export function CashierBillWorkspace({
  allowed,
  sessions,
  csrfToken,
  recoverCsrf,
  onSessionInvalid,
}: Props) {
  const [selectedId, setSelectedId] = useState('');
  const [billState, setBillState] = useState<BillState>({ status: 'idle' });
  const selectedIdRef = useRef(selectedId);
  const requestSequence = useRef(0);

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
                setSelectedId(event.target.value);
                setBillState({ status: 'idle' });
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

      {eligibleSessions.length === 0 ? (
        <div className="operational-state">
          <h3>Không có hóa đơn đang hoạt động</h3>
          <p>Workspace chỉ hiển thị phiên ACTIVE hoặc CHECKOUT_LOCKED trong địa điểm hiện tại.</p>
        </div>
      ) : !selected ? (
        <div className="operational-state">
          <h3>Chọn một phiên bàn</h3>
          <p>Các bàn chờ thanh toán được ưu tiên ở đầu danh sách.</p>
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
