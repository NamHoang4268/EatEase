import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatVnd } from '../public-menu/draft-cart';
import type { ConsolidatedSessionView } from '../public-menu/public-menu.types';
import type { useRealtime } from '../realtime/use-realtime';
import type { StaffActiveTableSession } from '../staff-activation/staff-activation.types';

const realtime = vi.hoisted(() => ({
  options: null as Parameters<typeof useRealtime>[0] | null,
}));

vi.mock('../realtime/use-realtime', () => ({
  useRealtime: (options: Parameters<typeof useRealtime>[0]) => {
    realtime.options = options;
    return { status: 'connected', reconnect: vi.fn() };
  },
}));

import { CashierBillWorkspace } from './cashier-bill-workspace';

const activeSession: StaffActiveTableSession = {
  id: 'a3000000-0000-4000-8000-000000000001',
  status: 'ACTIVE',
  version: 4,
  activatedAt: '2026-11-09T00:00:00.000Z',
  table: {
    publicId: 'a4000000-0000-4000-8000-000000000001',
    code: 'A01',
    capacity: 4,
  },
  joinCode: { hasActiveCode: false, expiresAt: null },
};

const lockedSession: StaffActiveTableSession = {
  ...activeSession,
  id: 'b3000000-0000-4000-8000-000000000002',
  status: 'CHECKOUT_LOCKED',
  version: 8,
  table: {
    publicId: 'b4000000-0000-4000-8000-000000000002',
    code: 'B02',
    capacity: 6,
  },
};

function billView(session = lockedSession): ConsolidatedSessionView {
  return {
    session: {
      id: session.id,
      status: session.status ?? 'ACTIVE',
      version: session.version,
      table: { publicId: session.table.publicId, code: session.table.code },
    },
    orders: [],
    bill: {
      id: 'bill-1',
      status: session.status === 'CHECKOUT_LOCKED' ? 'PAYMENT_PENDING' : 'OPEN',
      subtotalAmount: '9007199254740993',
      adjustmentAmount: '-1000000000000000',
      totalAmount: '8007199254740993',
      paidAmount: '0',
      balanceAmount: '8007199254740993',
      version: 7,
      lines: [
        {
          id: 'line-1',
          orderItemId: 'item-1',
          descriptionSnapshot: 'Cơm gà snapshot',
          quantity: 2,
          unitAmount: '4503599627370497',
          lineAmount: '9007199254740994',
        },
      ],
      adjustments: [
        {
          id: 'adjustment-1',
          orderItemId: 'item-1',
          kind: 'FULL_MANAGER_WAIVER',
          amount: '-1000000000000000',
          reason: 'Điều chỉnh đã duyệt',
          createdAt: '2026-11-09T01:00:00.000Z',
        },
      ],
    },
  };
}

function settledBillView(session = lockedSession): ConsolidatedSessionView {
  const view = billView(session);
  return {
    ...view,
    bill: {
      ...view.bill,
      status: 'SETTLED',
      paidAmount: view.bill.totalAmount,
      balanceAmount: '0',
      version: view.bill.version + 1,
    },
  };
}

function cashPaymentResponse(paymentAmount: string | null = '8007199254740993') {
  const settledAmount = paymentAmount ?? '0';
  return {
    data: {
      session: { id: lockedSession.id, status: 'CHECKOUT_LOCKED', version: lockedSession.version },
      bill: {
        id: 'bill-1',
        status: 'SETTLED',
        version: 8,
        totalAmount: settledAmount,
        paidAmount: settledAmount,
        balanceAmount: '0',
      },
      payment:
        paymentAmount === null
          ? null
          : {
              id: 'payment-1',
              method: 'CASH',
              status: 'SUCCEEDED',
              amount: paymentAmount,
              recordedAt: '2026-11-15T01:00:00.000Z',
            },
      settlement: {
        id: 'settlement-1',
        settledAmount,
        settledAt: '2026-11-15T01:00:00.000Z',
      },
    },
  };
}

function response(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  };
}

function renderWorkspace(overrides: Partial<ComponentProps<typeof CashierBillWorkspace>> = {}) {
  const props: ComponentProps<typeof CashierBillWorkspace> = {
    allowed: true,
    canRecordCash: true,
    sessions: [activeSession, lockedSession],
    csrfToken: 'staff-csrf',
    recoverCsrf: vi.fn(),
    onSessionInvalid: vi.fn(),
    ...overrides,
  };
  return { ...render(<CashierBillWorkspace {...props} />), props };
}

describe('CashierBillWorkspace', () => {
  afterEach(() => {
    cleanup();
    realtime.options = null;
    vi.unstubAllGlobals();
  });

  it('renders nothing without the combined table.session.read and bill.read authorization', () => {
    renderWorkspace({ allowed: false });
    expect(screen.queryByRole('heading', { name: 'Hóa đơn theo bàn' })).toBeNull();
    expect(realtime.options?.enabled).toBe(false);
  });

  it('lists only eligible scoped sessions and prioritizes checkout-locked tables', () => {
    renderWorkspace({
      sessions: [
        activeSession,
        {
          id: 'closed',
          version: 1,
          activatedAt: activeSession.activatedAt,
          table: { ...activeSession.table, code: 'C03' },
          joinCode: activeSession.joinCode,
        },
        lockedSession,
      ],
    });

    const select = screen.getByLabelText('Hóa đơn theo phiên bàn');
    const options = within(select).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'Chọn phiên bàn',
      'Bàn B02 · Đã khóa gọi món',
      'Bàn A01 · Đang gọi món',
    ]);
  });

  it('uses the scoped REST resource and renders exact snapshots, adjustments and BigInt money', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ data: billView() }));
    vi.stubGlobal('fetch', fetchMock);
    renderWorkspace();

    fireEvent.change(screen.getByLabelText('Hóa đơn theo phiên bàn'), {
      target: { value: lockedSession.id },
    });

    await screen.findByText('Cơm gà snapshot');
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/staff/table-sessions/${lockedSession.id}/bill`,
      { credentials: 'include', cache: 'no-store' },
    );
    expect(screen.getByText('Điều chỉnh đã duyệt')).toBeDefined();
    expect(
      screen.getByText((_, element) => element?.textContent === formatVnd(9_007_199_254_740_993n)),
    ).toBeDefined();
    expect(
      screen.getAllByText(
        (_, element) => element?.textContent === formatVnd(-1_000_000_000_000_000n),
      ),
    ).toHaveLength(2);
    expect(
      screen.getAllByText(
        (_, element) => element?.textContent === formatVnd(8_007_199_254_740_993n),
      ),
    ).toHaveLength(2);
    expect(screen.getByText(lockedSession.id)).toBeDefined();
    expect(screen.getByText(lockedSession.table.publicId)).toBeDefined();
  });

  it('refreshes manually and on realtime invalidation using the selected session', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ data: billView() }));
    vi.stubGlobal('fetch', fetchMock);
    renderWorkspace();
    fireEvent.change(screen.getByLabelText('Hóa đơn theo phiên bàn'), {
      target: { value: lockedSession.id },
    });
    await screen.findByText('Cơm gà snapshot');

    fireEvent.click(screen.getByRole('button', { name: 'Cập nhật' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await realtime.options?.onInvalidate();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(realtime.options).toMatchObject({
      actor: 'staff',
      audience: 'bill',
      enabled: true,
      tableSessionId: lockedSession.id,
    });
  });

  it('does not let a stale response overwrite a newer session selection', async () => {
    let resolveActive!: (value: unknown) => void;
    let resolveLocked!: (value: unknown) => void;
    const activeResponse = new Promise((resolve) => {
      resolveActive = resolve;
    });
    const lockedResponse = new Promise((resolve) => {
      resolveLocked = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation((url: string) =>
          url.includes(activeSession.id) ? activeResponse : lockedResponse,
        ),
    );
    renderWorkspace();

    const select = screen.getByLabelText('Hóa đơn theo phiên bàn');
    fireEvent.change(select, { target: { value: activeSession.id } });
    await waitFor(() => expect(realtime.options?.tableSessionId).toBe(activeSession.id));
    fireEvent.change(select, { target: { value: lockedSession.id } });
    await waitFor(() => expect(realtime.options?.tableSessionId).toBe(lockedSession.id));

    resolveLocked(response({ data: billView(lockedSession) }));
    await screen.findByText(lockedSession.id);
    resolveActive(response({ data: billView(activeSession) }));
    await Promise.resolve();
    expect(screen.queryByText(activeSession.id)).toBeNull();
    expect(screen.getByText(lockedSession.id)).toBeDefined();
  });

  it.each([
    [403, 'Không có quyền truy cập'],
    [409, 'Phiên bàn không còn khả dụng'],
    [500, 'Chưa thể tải hóa đơn'],
  ])('shows a recoverable error state for HTTP %s', async (status, heading) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({}, status)));
    renderWorkspace();
    fireEvent.change(screen.getByLabelText('Hóa đơn theo phiên bàn'), {
      target: { value: lockedSession.id },
    });
    expect(await screen.findByRole('heading', { name: heading })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeDefined();
  });

  it('hands an expired staff session back to the shared authentication flow', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({}, 401)));
    const onSessionInvalid = vi.fn();
    renderWorkspace({ onSessionInvalid });
    fireEvent.change(screen.getByLabelText('Hóa đơn theo phiên bàn'), {
      target: { value: lockedSession.id },
    });
    await waitFor(() => expect(onSessionInvalid).toHaveBeenCalledOnce());
  });

  it('shows the cash action only with permission on checkout-locked payment-pending data', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ data: billView() }));
    vi.stubGlobal('fetch', fetchMock);
    const view = renderWorkspace({ canRecordCash: false });
    fireEvent.change(screen.getByLabelText('Hóa đơn theo phiên bàn'), {
      target: { value: lockedSession.id },
    });
    await screen.findByText('Cơm gà snapshot');
    expect(screen.queryByRole('button', { name: 'Ghi nhận thanh toán tiền mặt' })).toBeNull();

    view.rerender(
      <CashierBillWorkspace
        {...view.props}
        canRecordCash
        sessions={[activeSession, lockedSession]}
      />,
    );
    expect(screen.getByRole('button', { name: 'Ghi nhận thanh toán tiền mặt' })).toBeDefined();

    fetchMock.mockResolvedValue(response({ data: settledBillView() }));
    fireEvent.click(screen.getByRole('button', { name: 'Cập nhật' }));
    await screen.findByRole('heading', { name: 'Đã tất toán (SETTLED)' });
    expect(screen.getAllByText('Đã khóa gọi món').length).toBeGreaterThan(0);
    expect(screen.queryByText('Chờ thanh toán')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ghi nhận thanh toán tiền mặt' })).toBeNull();
  });

  it('confirms the exact BigInt balance and explains zero-balance settlement without cash', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ data: billView() }));
    vi.stubGlobal('fetch', fetchMock);
    const view = renderWorkspace();
    fireEvent.change(screen.getByLabelText('Hóa đơn theo phiên bàn'), {
      target: { value: lockedSession.id },
    });
    await screen.findByText('Cơm gà snapshot');
    fireEvent.click(screen.getByRole('button', { name: 'Ghi nhận thanh toán tiền mặt' }));
    const confirmation = screen.getByRole('group', { name: 'Xác nhận thanh toán' });
    expect(
      within(confirmation).getByText(
        (_, element) =>
          element?.tagName === 'STRONG' &&
          element.textContent === formatVnd(8_007_199_254_740_993n),
      ),
    ).toBeDefined();
    expect(screen.getByText(/Phiên bàn vẫn CHECKOUT_LOCKED/)).toBeDefined();

    const zero = billView();
    zero.bill.totalAmount = '0';
    zero.bill.paidAmount = '0';
    zero.bill.balanceAmount = '0';
    fetchMock.mockResolvedValue(response({ data: zero }));
    fireEvent.click(screen.getByRole('button', { name: 'Cập nhật' }));
    await screen.findByText(/không ghi nhận tiền mặt giả/);
    expect(screen.getByRole('button', { name: 'Xác nhận tất toán số dư 0 ₫' })).toBeDefined();
    view.unmount();
  });

  it('posts only current versions with Staff CSRF and one stable key while preventing double submit', async () => {
    let resolvePayment!: (value: unknown) => void;
    const payment = new Promise((resolve) => {
      resolvePayment = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockImplementation((url: string) =>
        url.endsWith('/bill') ? Promise.resolve(response({ data: billView() })) : payment,
      );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('crypto', { randomUUID: vi.fn().mockReturnValue('cash-key-1') });
    renderWorkspace();
    fireEvent.change(screen.getByLabelText('Hóa đơn theo phiên bàn'), {
      target: { value: lockedSession.id },
    });
    await screen.findByText('Cơm gà snapshot');
    fireEvent.click(screen.getByRole('button', { name: 'Ghi nhận thanh toán tiền mặt' }));
    const confirm = screen.getByRole('button', { name: 'Xác nhận đã nhận đủ tiền' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/cash-payment')),
      ).toHaveLength(1),
    );
    const paymentCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith('/cash-payment'),
    )!;
    expect(paymentCall).toEqual([
      `/api/v1/staff/table-sessions/${lockedSession.id}/cash-payment`,
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'cash-key-1',
          'X-CSRF-Token': 'staff-csrf',
        },
        body: JSON.stringify({
          expectedSessionVersion: lockedSession.version,
          expectedBillVersion: 7,
        }),
      },
    ]);
    resolvePayment(response(cashPaymentResponse()));
    await screen.findByText(/Đã ghi nhận tiền mặt/);
  });

  it('settles a zero-balance Bill without presenting or sending a cash amount', async () => {
    const zero = billView();
    zero.bill.totalAmount = '0';
    zero.bill.paidAmount = '0';
    zero.bill.balanceAmount = '0';
    const settledZero = settledBillView();
    settledZero.bill.totalAmount = '0';
    settledZero.bill.paidAmount = '0';
    let settled = false;
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/bill'))
        return Promise.resolve(response({ data: settled ? settledZero : zero }));
      settled = true;
      return Promise.resolve(response(cashPaymentResponse(null)));
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWorkspace();
    fireEvent.change(screen.getByLabelText('Hóa đơn theo phiên bàn'), {
      target: { value: lockedSession.id },
    });
    await screen.findByText('Cơm gà snapshot');
    fireEvent.click(screen.getByRole('button', { name: 'Ghi nhận thanh toán tiền mặt' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận tất toán số dư 0 ₫' }));
    expect(await screen.findByText(/không tạo bản ghi thu tiền mặt/)).toBeDefined();
    const cashCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/cash-payment'))!;
    expect(JSON.parse((cashCall[1] as RequestInit).body as string)).toEqual({
      expectedSessionVersion: lockedSession.version,
      expectedBillVersion: 7,
    });
  });

  it('retries a lost response with the identical key and original version payload', async () => {
    let settled = false;
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/bill'))
        return Promise.resolve(response({ data: settled ? settledBillView() : billView() }));
      const paymentCalls = fetchMock.mock.calls.filter(([calledUrl]) =>
        String(calledUrl).endsWith('/cash-payment'),
      ).length;
      if (paymentCalls === 1) return Promise.reject(new Error('lost response'));
      settled = true;
      return Promise.resolve(response(cashPaymentResponse()));
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('crypto', { randomUUID: vi.fn().mockReturnValue('stable-cash-key') });
    renderWorkspace();
    fireEvent.change(screen.getByLabelText('Hóa đơn theo phiên bàn'), {
      target: { value: lockedSession.id },
    });
    await screen.findByText('Cơm gà snapshot');
    fireEvent.click(screen.getByRole('button', { name: 'Ghi nhận thanh toán tiền mặt' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận đã nhận đủ tiền' }));
    await screen.findByText(/Kết nối bị gián đoạn và kết quả chưa chắc chắn/);
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại cùng yêu cầu' }));
    await screen.findByRole('heading', { name: 'Đã tất toán (SETTLED)' });
    const calls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/cash-payment'));
    expect(calls).toHaveLength(2);
    expect(calls[1]![1]).toEqual(calls[0]![1]);
  });

  it('recovers Staff CSRF with the same operation and refetches after a definitive conflict', async () => {
    const recoverCsrf = vi.fn().mockResolvedValue('fresh-staff-csrf');
    let paymentCalls = 0;
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/bill')) return Promise.resolve(response({ data: billView() }));
      paymentCalls += 1;
      return Promise.resolve(
        paymentCalls === 1
          ? response({ error: { code: 'STAFF_CSRF_INVALID' } }, 403)
          : response({ error: { code: 'CASH_PAYMENT_VERSION_CONFLICT' } }, 409),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('crypto', { randomUUID: vi.fn().mockReturnValue('conflict-key') });
    renderWorkspace({ recoverCsrf });
    fireEvent.change(screen.getByLabelText('Hóa đơn theo phiên bàn'), {
      target: { value: lockedSession.id },
    });
    await screen.findByText('Cơm gà snapshot');
    fireEvent.click(screen.getByRole('button', { name: 'Ghi nhận thanh toán tiền mặt' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận đã nhận đủ tiền' }));
    await screen.findByText(/đã thay đổi/);
    expect(recoverCsrf).toHaveBeenCalledOnce();
    const calls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/cash-payment'));
    expect(calls[1]![1]).toEqual({
      ...(calls[0]![1] as RequestInit),
      headers: {
        ...((calls[0]![1] as RequestInit).headers as Record<string, string>),
        'X-CSRF-Token': 'fresh-staff-csrf',
      },
    });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/bill'))).toHaveLength(2);
  });

  it.each([
    [401, 'STAFF_SESSION_INVALID', true, /./],
    [403, 'STAFF_AUTHORIZATION_DENIED', false, /không còn quyền/],
  ] as const)(
    'handles definitive authentication and authorization failure %s',
    async (status, code, expiresSession, notice) => {
      const fetchMock = vi
        .fn()
        .mockImplementation((url: string) =>
          url.endsWith('/bill')
            ? Promise.resolve(response({ data: billView() }))
            : Promise.resolve(response({ error: { code } }, status)),
        );
      vi.stubGlobal('fetch', fetchMock);
      const onSessionInvalid = vi.fn();
      renderWorkspace({ onSessionInvalid });
      fireEvent.change(screen.getByLabelText('Hóa đơn theo phiên bàn'), {
        target: { value: lockedSession.id },
      });
      await screen.findByText('Cơm gà snapshot');
      fireEvent.click(screen.getByRole('button', { name: 'Ghi nhận thanh toán tiền mặt' }));
      fireEvent.click(screen.getByRole('button', { name: 'Xác nhận đã nhận đủ tiền' }));
      if (expiresSession) await waitFor(() => expect(onSessionInvalid).toHaveBeenCalledOnce());
      else expect(await screen.findByText(notice)).toBeDefined();
    },
  );

  it('does not apply an old settlement response after selecting another table', async () => {
    const secondLocked = {
      ...lockedSession,
      id: 'c3000000-0000-4000-8000-000000000003',
      table: { ...lockedSession.table, code: 'C03' },
    };
    let resolvePayment!: (value: unknown) => void;
    const payment = new Promise((resolve) => {
      resolvePayment = resolve;
    });
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/cash-payment')) return payment;
      return Promise.resolve(
        response({ data: billView(url.includes(secondLocked.id) ? secondLocked : lockedSession) }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWorkspace({ sessions: [lockedSession, secondLocked] });
    const select = screen.getByLabelText('Hóa đơn theo phiên bàn');
    fireEvent.change(select, { target: { value: lockedSession.id } });
    await screen.findByText(lockedSession.id);
    fireEvent.click(screen.getByRole('button', { name: 'Ghi nhận thanh toán tiền mặt' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận đã nhận đủ tiền' }));
    fireEvent.change(select, { target: { value: secondLocked.id } });
    await screen.findByText(secondLocked.id);
    resolvePayment(response(cashPaymentResponse()));
    await Promise.resolve();
    expect(screen.getByText(secondLocked.id)).toBeDefined();
    expect(screen.queryByText(/Đã ghi nhận tiền mặt/)).toBeNull();
  });
});
