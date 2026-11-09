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
      paidAmount: '123456789012345',
      balanceAmount: '7883742465728648',
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
      'Bàn B02 · Chờ thanh toán',
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
      screen.getByText((_, element) => element?.textContent === formatVnd(7_883_742_465_728_648n)),
    ).toBeDefined();
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
});
