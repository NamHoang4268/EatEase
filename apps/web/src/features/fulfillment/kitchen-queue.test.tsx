import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KitchenQueue } from './kitchen-queue';

const empty = { items: [], page: { limit: 50, nextCursor: null } };
const boardItem = {
  id: 'item',
  nameSnapshot: 'Cơm gà',
  quantity: 1,
  note: null,
  stationSnapshot: 'KITCHEN',
  status: 'NEW',
  version: 7,
  order: {
    id: 'order',
    orderNumber: 'ORDER-1',
    source: 'QR_GUEST',
    submittedAt: '2026-11-05T00:00:00.000Z',
  },
  table: { code: 'A01' },
};
const boardPage = (item = boardItem) => ({ ...empty, items: [item] });
function response(data: unknown = empty, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => ({ data }) };
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('KitchenQueue', () => {
  it.each(['KITCHEN', 'BAR', 'DIRECT'])(
    'allows serving %s READY with serving permission and shows SERVED as terminal',
    async (stationSnapshot) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          response(boardPage({ ...boardItem, stationSnapshot, status: 'READY' })),
        )
        .mockResolvedValue(
          response(boardPage({ ...boardItem, stationSnapshot, status: 'SERVED' })),
        );
      vi.stubGlobal('fetch', fetchMock);
      render(<KitchenQueue allowed canServe csrfToken="csrf" onSessionInvalid={vi.fn()} />);
      expect(await screen.findByRole('button', { name: 'Đánh dấu đã phục vụ' })).toBeDefined();
      expect(screen.queryByRole('button', { name: 'Bắt đầu chuẩn bị' })).toBeNull();
      fireEvent.change(screen.getByLabelText('Trạng thái món'), { target: { value: 'SERVED' } });
      await screen.findByText(`${stationSnapshot} · Đã phục vụ`);
      expect(String(fetchMock.mock.lastCall?.[0])).toContain('status=SERVED');
      expect(screen.queryByRole('button', { name: /Đánh dấu|Bắt đầu/ })).toBeNull();
    },
  );

  it.each([false, true])(
    'requires serving permission and recovered CSRF for READY (permission %s)',
    async (canServe) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(response(boardPage({ ...boardItem, status: 'READY' }))),
      );
      render(<KitchenQueue allowed canTransition canServe={canServe} onSessionInvalid={vi.fn()} />);
      await screen.findByText('Bàn A01 · Cơm gà');
      const button = screen.queryByRole('button', { name: 'Đánh dấu đã phục vụ' });
      if (canServe) expect((button as HTMLButtonElement).disabled).toBe(true);
      else expect(button).toBeNull();
    },
  );
  it.each([
    ['KITCHEN', 'NEW', 'Bắt đầu chuẩn bị'],
    ['BAR', 'NEW', 'Bắt đầu chuẩn bị'],
    ['KITCHEN', 'PREPARING', 'Đánh dấu sẵn sàng'],
    ['BAR', 'PREPARING', 'Đánh dấu sẵn sàng'],
    ['DIRECT', 'NEW', 'Đánh dấu sẵn sàng'],
    ['DIRECT', 'PREPARING', null],
    ['KITCHEN', 'READY', null],
    ['BAR', 'READY', null],
    ['DIRECT', 'READY', null],
  ])('shows only the permitted action for %s/%s', async (stationSnapshot, status, label) => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          response(boardPage({ ...boardItem, stationSnapshot: stationSnapshot!, status: status! })),
        ),
    );
    render(<KitchenQueue allowed canTransition csrfToken="csrf" onSessionInvalid={vi.fn()} />);
    await screen.findByText('Bàn A01 · Cơm gà');
    const action = screen.queryByRole('button', { name: /Bắt đầu chuẩn bị|Đánh dấu sẵn sàng/ });
    if (label) expect(action?.textContent).toBe(label);
    else expect(action).toBeNull();
  });

  it.each([false, true])(
    'requires mutation permission and recovered CSRF (permission %s)',
    async (canTransition) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(boardPage())));
      render(<KitchenQueue allowed canTransition={canTransition} onSessionInvalid={vi.fn()} />);
      await screen.findByText('Bàn A01 · Cơm gà');
      const action = screen.queryByRole('button', { name: 'Bắt đầu chuẩn bị' });
      if (canTransition) expect((action as HTMLButtonElement).disabled).toBe(true);
      else expect(action).toBeNull();
    },
  );

  it.each([
    ['KITCHEN', 'NEW', 'start-preparation', 'Bắt đầu chuẩn bị'],
    ['BAR', 'PREPARING', 'mark-ready', 'Đánh dấu sẵn sàng'],
    ['DIRECT', 'NEW', 'mark-ready', 'Đánh dấu sẵn sàng'],
    ['KITCHEN', 'READY', 'mark-served', 'Đánh dấu đã phục vụ'],
  ])(
    'sends %s/%s with the server version, prevents double clicks and refetches',
    async (stationSnapshot, status, endpoint, label) => {
      let finish: (value: ReturnType<typeof response>) => void = () => {};
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          response(boardPage({ ...boardItem, stationSnapshot: stationSnapshot!, status: status! })),
        )
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finish = resolve;
            }),
        )
        .mockResolvedValue(response());
      vi.stubGlobal('fetch', fetchMock);
      render(
        <KitchenQueue
          allowed
          canTransition={endpoint !== 'mark-served'}
          canServe={endpoint === 'mark-served'}
          csrfToken="csrf"
          onSessionInvalid={vi.fn()}
        />,
      );
      const button = await screen.findByRole('button', { name: label! });
      fireEvent.click(button);
      fireEvent.click(button);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[1]?.[0]).toBe(`/api/v1/staff/fulfillment/items/item/${endpoint}`);
      expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        body: JSON.stringify({ expectedVersion: 7 }),
        headers: { 'X-CSRF-Token': 'csrf', 'Idempotency-Key': expect.any(String) },
      });
      expect(screen.getByText('Bàn A01 · Cơm gà')).toBeDefined();
      finish(response());
      await screen.findByText('Chưa có món ở trạng thái này tại trạm đã chọn.');
      expect(fetchMock).toHaveBeenCalledTimes(3);
    },
  );

  it.each(['NEW', 'READY'])(
    'retains the same %s key through network/5xx failures and CSRF recovery',
    async (status) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(response(boardPage({ ...boardItem, status })))
        .mockRejectedValueOnce(new Error('network'))
        .mockResolvedValueOnce(response(null, 503))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: { code: 'STAFF_CSRF_INVALID' } }), { status: 403 }),
        )
        .mockResolvedValueOnce(response())
        .mockResolvedValue(response());
      const recoverCsrf = vi.fn().mockResolvedValue('replacement');
      vi.stubGlobal('fetch', fetchMock);
      render(
        <KitchenQueue
          allowed
          canTransition={status === 'NEW'}
          canServe={status === 'READY'}
          csrfToken="csrf"
          recoverCsrf={recoverCsrf}
          onSessionInvalid={vi.fn()}
        />,
      );
      const label = status === 'NEW' ? 'Bắt đầu chuẩn bị' : 'Đánh dấu đã phục vụ';
      fireEvent.click(await screen.findByRole('button', { name: label }));
      await screen.findByText(/Kết nối bị gián đoạn/);
      fireEvent.click(screen.getByRole('button', { name: label }));
      await screen.findByText(/Chưa thể xác nhận thao tác/);
      fireEvent.click(screen.getByRole('button', { name: label }));
      await screen.findByText('Chưa có món ở trạng thái này tại trạm đã chọn.');
      const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
      expect(posts).toHaveLength(4);
      expect(new Set(posts.map(([, init]) => init.headers['Idempotency-Key'])).size).toBe(1);
      expect(posts[3]?.[1].headers['X-CSRF-Token']).toBe('replacement');
      expect(recoverCsrf).toHaveBeenCalledOnce();
    },
  );

  it.each([
    [401, 'NEW'],
    [403, 'NEW'],
    [409, 'NEW'],
    [401, 'READY'],
    [403, 'READY'],
    [409, 'READY'],
  ] as const)(
    'handles mutation HTTP %s for %s without inventing success',
    async (status, itemStatus) => {
      const onSessionInvalid = vi.fn();
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(response(boardPage({ ...boardItem, status: itemStatus })))
        .mockResolvedValueOnce(response(null, status))
        .mockResolvedValue(response());
      vi.stubGlobal('fetch', fetchMock);
      render(
        <KitchenQueue
          allowed
          canTransition={itemStatus === 'NEW'}
          canServe={itemStatus === 'READY'}
          csrfToken="csrf"
          onSessionInvalid={onSessionInvalid}
        />,
      );
      fireEvent.click(
        await screen.findByRole('button', {
          name: itemStatus === 'NEW' ? 'Bắt đầu chuẩn bị' : 'Đánh dấu đã phục vụ',
        }),
      );
      if (status === 401) await waitFor(() => expect(onSessionInvalid).toHaveBeenCalledOnce());
      if (status === 403) await screen.findByText(/Bạn không còn quyền thực hiện/);
      if (status === 409) {
        await screen.findByText(/Trạng thái món hoặc lần thao tác đã thay đổi/);
        await screen.findByText('Chưa có món ở trạng thái này tại trạm đã chọn.');
        expect(fetchMock).toHaveBeenCalledTimes(3);
      }
      expect(screen.queryByText(/Đã cập nhật món/)).toBeNull();
    },
  );

  it('keeps the retry key after CSRF recovery fails and expires only on a confirmed invalid session', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(boardPage()))
      .mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: { code: 'STAFF_CSRF_INVALID' } }), { status: 403 }),
        ),
      );
    const recoverCsrf = vi
      .fn()
      .mockRejectedValueOnce(new Error('STAFF_CSRF_RECOVERY_FAILED'))
      .mockRejectedValueOnce(new Error('STAFF_SESSION_INVALID'));
    const onSessionInvalid = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(
      <KitchenQueue
        allowed
        canTransition
        csrfToken="csrf"
        recoverCsrf={recoverCsrf}
        onSessionInvalid={onSessionInvalid}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Bắt đầu chuẩn bị' }));
    await screen.findByText(/Kết nối bị gián đoạn/);
    expect(onSessionInvalid).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu chuẩn bị' }));
    await waitFor(() => expect(onSessionInvalid).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[1]?.[1].headers['Idempotency-Key']).toBe(
      fetchMock.mock.calls[2]?.[1].headers['Idempotency-Key'],
    );
  });

  it('uses the refreshed version and a new logical action after a stale-version conflict', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(boardPage()))
      .mockResolvedValueOnce(response(null, 409))
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response(boardPage({ ...boardItem, status: 'PREPARING', version: 8 })))
      .mockResolvedValueOnce(response())
      .mockResolvedValue(response());
    vi.stubGlobal('fetch', fetchMock);
    render(<KitchenQueue allowed canTransition csrfToken="csrf" onSessionInvalid={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Bắt đầu chuẩn bị' }));
    await screen.findByText(/Trạng thái món hoặc lần thao tác đã thay đổi/);
    await screen.findByText('Chưa có món ở trạng thái này tại trạm đã chọn.');
    fireEvent.change(screen.getByLabelText('Trạng thái món'), { target: { value: 'PREPARING' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Đánh dấu sẵn sàng' }));
    await screen.findByText('Chưa có món ở trạng thái này tại trạm đã chọn.');
    const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(posts[1]?.[0]).toContain('/mark-ready');
    expect(posts[1]?.[1].body).toBe(JSON.stringify({ expectedVersion: 8 }));
    expect(posts[1]?.[1].headers['Idempotency-Key']).not.toBe(
      posts[0]?.[1].headers['Idempotency-Key'],
    );
  });

  it('changes state filters without reusing the previous page cursor', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetchMock);
    render(<KitchenQueue allowed onSessionInvalid={vi.fn()} />);
    await screen.findByText('Chưa có món ở trạng thái này tại trạm đã chọn.');
    for (const status of ['PREPARING', 'READY']) {
      fireEvent.change(screen.getByLabelText('Trạng thái món'), { target: { value: status } });
      await waitFor(() =>
        expect(String(fetchMock.mock.lastCall?.[0])).toContain(`status=${status}`),
      );
      await screen.findByText('Chưa có món ở trạng thái này tại trạm đã chọn.');
      expect(String(fetchMock.mock.lastCall?.[0])).not.toContain('cursor');
    }
  });

  it('shows loading then empty, and refreshes only on explicit action', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetchMock);
    render(<KitchenQueue allowed onSessionInvalid={vi.fn()} />);
    expect(screen.getByText('Đang tải hàng chờ bếp…')).toBeDefined();
    await screen.findByText('Chưa có món ở trạng thái này tại trạm đã chọn.');
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
    await screen.findByText('Chưa có món ở trạng thái này tại trạm đã chọn.');
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
    await screen.findByText('Chưa có món ở trạng thái này tại trạm đã chọn.');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
