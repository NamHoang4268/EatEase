import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KitchenQueue } from './kitchen-queue';

const empty = { items: [], page: { limit: 50, nextCursor: null } };
function response(data: unknown = empty, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => ({ data }) };
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('KitchenQueue', () => {
  it('shows loading then empty, and refreshes only on explicit action', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetchMock);
    render(<KitchenQueue allowed onSessionInvalid={vi.fn()} />);
    expect(screen.getByText('Đang tải hàng chờ bếp…')).toBeDefined();
    await screen.findByText('Chưa có món mới đang chờ tại trạm này.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Làm mới hàng chờ' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      credentials: 'include',
      cache: 'no-store',
    });
  });

  it('never fetches for a staff member without permission', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<KitchenQueue allowed={false} onSessionInvalid={vi.fn()} />);
    expect(screen.getByText('Bạn không có quyền xem hàng chờ bếp.')).toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([401, 403, 503])('handles HTTP %i without exposing stale queue data', async (status) => {
    const onSessionInvalid = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(null, status)));
    render(<KitchenQueue allowed onSessionInvalid={onSessionInvalid} />);
    await screen.findByRole('alert');
    expect(onSessionInvalid).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('shows operational snapshots and uses the cursor only for the next page', async () => {
    const item = {
      id: 'item',
      nameSnapshot: 'Phở snapshot',
      quantity: 2,
      note: 'Không hành',
      stationSnapshot: 'KITCHEN',
      status: 'NEW',
      order: {
        id: 'order',
        orderNumber: 'ORDER-1',
        source: 'STAFF_WAITER',
        submittedAt: '2026-11-05T00:00:00.000Z',
      },
      table: { code: 'A01' },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({ items: [item], page: { limit: 50, nextCursor: 'page-two' } }),
      )
      .mockResolvedValue(response());
    vi.stubGlobal('fetch', fetchMock);
    render(<KitchenQueue allowed onSessionInvalid={vi.fn()} />);
    await screen.findByText('Bàn A01 · Phở snapshot');
    expect(screen.getByText('Ghi chú: Không hành')).toBeDefined();
    expect(screen.queryByRole('button', { name: /Chuẩn bị|Sẵn sàng|Phục vụ/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Trang tiếp theo' }));
    await screen.findByText('Chưa có món mới đang chờ tại trạm này.');
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('cursor=page-two');
    fireEvent.change(screen.getByLabelText('Trạm phục vụ'), { target: { value: 'BAR' } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain('station=BAR');
    expect(String(fetchMock.mock.calls[2]?.[0])).not.toContain('cursor');
  });

  it('prevents parallel refresh clicks and recovers after a network error', async () => {
    let reject: (reason: Error) => void = () => {};
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, rejectPromise) => {
            reject = rejectPromise;
          }),
      )
      .mockResolvedValue(response());
    vi.stubGlobal('fetch', fetchMock);
    render(<KitchenQueue allowed onSessionInvalid={vi.fn()} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Làm mới hàng chờ' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    reject(new Error('network'));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Làm mới hàng chờ' }));
    await screen.findByText('Chưa có món mới đang chờ tại trạm này.');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
