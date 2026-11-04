import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StaffOrderingPanel } from './staff-ordering-panel';

const session = {
  id: 'a3000000-0000-4000-8000-000000000001',
  version: 1,
  activatedAt: '2026-11-05T00:00:00.000Z',
  table: {
    publicId: 'a4000000-0000-4000-8000-000000000001',
    code: 'A01',
    capacity: 4,
  },
  joinCode: { hasActiveCode: false, expiresAt: null },
};
const menu = {
  data: {
    currency: 'VND',
    categories: [
      {
        id: 'category-1',
        name: 'Món chính',
        items: [
          {
            id: 'a5000000-0000-4000-8000-000000000001',
            name: 'Cơm gà',
            description: null,
            priceAmount: '79000',
            currency: 'VND',
            fulfillmentStation: 'KITCHEN',
            available: true,
          },
        ],
      },
    ],
  },
};
const emptyBill = {
  data: {
    session: { id: session.id, status: 'ACTIVE', table: session.table },
    orders: [],
    bill: {
      id: 'bill-1',
      status: 'OPEN',
      subtotalAmount: '0',
      adjustmentAmount: '0',
      totalAmount: '0',
      paidAmount: '0',
      balanceAmount: '0',
      version: 0,
      lines: [],
    },
  },
};

function response(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: vi.fn().mockResolvedValue(body) };
}

describe('StaffOrderingPanel', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('uses the selected active table and clears the draft only after a confirmed submission', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'staff-order-key' });
    let submitCount = 0;
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/v1/public/menu')) return Promise.resolve(response(menu));
      if (url.endsWith('/bill')) return Promise.resolve(response(emptyBill));
      if (url.endsWith('/orders') && init?.method === 'POST') {
        submitCount += 1;
        return submitCount === 1
          ? Promise.reject(new Error('network'))
          : Promise.resolve(response({ data: { order: { id: 'order-1' } } }, 201));
      }
      return Promise.reject(new Error(`Unhandled url: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <StaffOrderingPanel
        canReadBill
        canSubmit
        csrfToken="staff-csrf"
        recoverCsrf={vi.fn()}
        sessions={[session]}
        onSessionInvalid={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Phiên bàn'), { target: { value: session.id } });
    expect(await screen.findByText('Cơm gà')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Thêm' }));
    fireEvent.click(screen.getByRole('button', { name: 'Gửi order' }));
    expect(await screen.findByText(/Kết nối bị gián đoạn/)).toBeDefined();
    expect(screen.getAllByText('Cơm gà')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Gửi order' }));
    await waitFor(() => expect(screen.getByText('Chưa chọn món.')).toBeDefined());

    const submitCalls = fetchMock.mock.calls.filter((call: unknown[]) =>
      String(call[0]).endsWith('/orders'),
    );
    expect(submitCalls).toHaveLength(2);
    for (const call of submitCalls) {
      expect((call[1] as RequestInit).headers).toMatchObject({
        'Idempotency-Key': 'staff-order-key',
        'X-CSRF-Token': 'staff-csrf',
      });
    }
  });
});
