import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { useRealtime } from './use-realtime';
const subscriptions = vi.hoisted(() => new Map<string, Parameters<typeof useRealtime>[0]>());
vi.mock('./use-realtime', () => ({
  useRealtime: (options: Parameters<typeof useRealtime>[0]) => {
    subscriptions.set(`${options.actor}:${options.audience}`, options);
    return { status: 'connected', reconnect: vi.fn() };
  },
}));
import { KitchenQueue } from '../fulfillment/kitchen-queue';
import { StaffOrderingPanel } from '../staff-activation/staff-ordering-panel';
import { PublicMenuExperience } from '../public-menu/public-menu-experience';

const session = {
  id: 'a3000000-0000-4000-8000-000000000001',
  version: 1,
  activatedAt: '2026-11-05T00:00:00.000Z',
  table: { publicId: 'a4000000-0000-4000-8000-000000000001', code: 'A01', capacity: 4 },
  joinCode: { hasActiveCode: false, expiresAt: null },
};
const menu = {
  currency: 'VND',
  categories: [
    {
      id: 'category',
      name: 'Món chính',
      items: [
        {
          id: 'item',
          name: 'Cơm gà',
          description: null,
          priceAmount: '42000',
          currency: 'VND',
          fulfillmentStation: 'KITCHEN',
          available: true,
        },
      ],
    },
  ],
};
const view = {
  session: { id: session.id, status: 'ACTIVE', table: session.table },
  orders: [],
  bill: {
    id: 'bill',
    status: 'OPEN',
    subtotalAmount: '0',
    adjustmentAmount: '0',
    totalAmount: '0',
    paidAmount: '0',
    balanceAmount: '0',
    version: 0,
    lines: [],
  },
};
const response = (data: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => ({ data }),
});
beforeEach(() => subscriptions.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe('realtime view invalidation', () => {
  it.each(['NEW', 'PREPARING', 'READY', 'SERVED'])(
    'refetches the selected %s board on kitchen invalidation without mutating',
    async (status) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(response({ items: [], page: { limit: 50, nextCursor: null } }));
      vi.stubGlobal('fetch', fetchMock);
      render(<KitchenQueue allowed csrfToken="csrf" onSessionInvalid={vi.fn()} />);
      await screen.findByText('Chưa có món ở trạng thái này tại trạm đã chọn.');
      if (status !== 'NEW') {
        fireEvent.change(screen.getByLabelText('Trạng thái món'), { target: { value: status } });
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        await screen.findByText('Chưa có món ở trạng thái này tại trạm đã chọn.');
      }
      const reads = fetchMock.mock.calls.length;
      await act(async () => {
        await subscriptions.get('staff:kitchen')!.onInvalidate();
      });
      expect(fetchMock).toHaveBeenCalledTimes(reads + 1);
      expect(String(fetchMock.mock.lastCall?.[0])).toContain(`status=${status}`);
      expect(
        fetchMock.mock.calls.every(
          ([url, init]) =>
            String(url).includes('/staff/fulfillment/items') &&
            (init as RequestInit).method === undefined,
        ),
      ).toBe(true);
    },
  );
  it('refreshes staff bill only and preserves an in-progress Waiter draft', async () => {
    let billReads = 0;
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/public/menu')) return response(menu);
      if (url.endsWith('/bill')) {
        billReads++;
        return response(view);
      }
      throw new Error('Unexpected request');
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <StaffOrderingPanel
        sessions={[session]}
        canSubmit
        canReadBill
        csrfToken="csrf"
        recoverCsrf={vi.fn()}
        onSessionInvalid={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('Phiên bàn'), { target: { value: session.id } });
    await screen.findByText('Cơm gà');
    fireEvent.click(screen.getByRole('button', { name: 'Thêm' }));
    await act(async () => {
      await subscriptions.get('staff:bill')!.onInvalidate();
    });
    expect(billReads).toBe(2);
    expect(screen.getAllByText('Cơm gà')).toHaveLength(2);
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).includes('/public/menu')),
    ).toHaveLength(1);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/orders'))).toBe(false);
  });
  it('refreshes Guest consolidated bill without submitting or clearing the local cart', async () => {
    let billReads = 0;
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/public/tables/'))
        return response({
          publicId: session.table.publicId,
          restaurantName: 'M211 Demo',
          locationName: 'Demo',
          tableLabel: 'A01',
          capacity: 4,
          availability: 'BROWSE_ONLY',
        });
      if (url.includes('/public/menu')) return response(menu);
      if (url.endsWith('/guest-sessions'))
        return response({
          table: { publicId: session.table.publicId },
          activationState: 'NOT_REQUESTED',
          session: {
            accessLevel: 'ORDER_ENABLED',
            idleExpiresAt: new Date(Date.now() + 1800000).toISOString(),
            absoluteExpiresAt: new Date(Date.now() + 3600000).toISOString(),
          },
          csrfToken: 'csrf',
        });
      if (url.endsWith('/activation-requests/current'))
        return response({ status: 'NOT_REQUESTED' });
      if (url.endsWith('/join-code')) return response(null, 403);
      if (url.endsWith('/table-sessions/current')) {
        billReads++;
        return response(view);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<PublicMenuExperience publicId={session.table.publicId} />);
    await screen.findByText('M211 Demo');
    await waitFor(() => expect(subscriptions.get('guest:bill')?.enabled).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Thêm Cơm gà vào giỏ nháp' }));
    await act(async () => {
      await subscriptions.get('guest:bill')!.onInvalidate();
    });
    fireEvent.click(screen.getByRole('button', { name: /Giỏ nháp/ }));
    expect(screen.getByLabelText('Số lượng hiện tại: 1')).toBeDefined();
    expect(billReads).toBeGreaterThanOrEqual(2);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/orders'))).toBe(false);
  });
});
