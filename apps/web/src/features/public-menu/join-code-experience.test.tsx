import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PublicMenuExperience } from './public-menu-experience';

const publicId = '31000000-0000-4000-8000-000000000001';
const table = {
  publicId,
  restaurantName: 'Bếp Mây Demo',
  locationName: 'Chi nhánh Demo',
  tableLabel: 'A01',
  capacity: 4,
  availability: 'BROWSE_ONLY',
};
const menu = {
  currency: 'VND',
  categories: [
    {
      id: 'cat-1',
      name: 'Món Việt',
      items: [
        {
          id: 'item-1',
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
};

function response(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: vi.fn().mockResolvedValue(body) };
}

function bootstrap(accessLevel: 'BROWSE_ONLY' | 'ORDER_ENABLED') {
  return response({
    data: {
      table,
      activationState: 'NOT_REQUESTED',
      session: {
        accessLevel,
        idleExpiresAt: new Date(Date.now() + 1_800_000).toISOString(),
        absoluteExpiresAt: new Date(Date.now() + 28_800_000).toISOString(),
      },
      csrfToken: 'guest-csrf',
    },
  });
}

function joinSuccess() {
  return response({
    data: {
      session: { accessLevel: 'ORDER_ENABLED', tableSessionId: 'session-1', version: 1 },
      csrfToken: 'joined-csrf',
    },
  });
}

function joinScenario(joinReplies: Array<() => Promise<unknown>>) {
  let joinIndex = 0;
  return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (url.includes('/public/tables/')) return Promise.resolve(response({ data: table }));
    if (url.includes('/public/menu')) return Promise.resolve(response({ data: menu }));
    if (url === '/api/v1/guest-sessions' && init?.method === 'POST')
      return Promise.resolve(bootstrap('BROWSE_ONLY'));
    if (url === '/api/v1/activation-requests/current')
      return Promise.resolve(response({ data: { status: 'NOT_REQUESTED' } }));
    if (url === '/api/v1/guest-sessions/csrf-token')
      return Promise.resolve(response({ data: { csrfToken: 'recovered-csrf' } }));
    if (url === '/api/v1/table-sessions/join' && init?.method === 'POST') {
      const reply = joinReplies[Math.min(joinIndex, joinReplies.length - 1)];
      joinIndex += 1;
      return reply?.() ?? Promise.reject(new Error('Missing Join response'));
    }
    if (url === '/api/v1/guest-sessions/current')
      return Promise.resolve(response({ data: { session: { accessLevel: 'ORDER_ENABLED' } } }));
    if (url === '/api/v1/table-sessions/current/join-code')
      return Promise.resolve(response({ error: { code: 'JOIN_CODE_HOST_ACCESS_DENIED' } }, 403));
    return Promise.reject(new Error(`Unhandled ${url}`));
  });
}

async function submitJoin(): Promise<void> {
  await screen.findByRole('heading', { name: 'Tham gia bàn bằng mã mời' });
  fireEvent.change(screen.getByLabelText('Join Code'), { target: { value: '482193' } });
  fireEvent.click(screen.getByRole('button', { name: 'Tham gia bàn' }));
}

describe('M2.7 Host and Join experience', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('joins an active table explicitly and preserves the local draft cart', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'join-key' });
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/public/tables/')) return Promise.resolve(response({ data: table }));
      if (url.includes('/public/menu')) return Promise.resolve(response({ data: menu }));
      if (url === '/api/v1/guest-sessions' && init?.method === 'POST')
        return Promise.resolve(bootstrap('BROWSE_ONLY'));
      if (url === '/api/v1/activation-requests/current')
        return Promise.resolve(response({ data: { status: 'NOT_REQUESTED' } }));
      if (url === '/api/v1/table-sessions/join' && init?.method === 'POST')
        return Promise.resolve(
          response({
            data: {
              session: { accessLevel: 'ORDER_ENABLED', tableSessionId: 'session-1', version: 1 },
              csrfToken: 'joined-csrf',
            },
          }),
        );
      if (url === '/api/v1/guest-sessions/current')
        return Promise.resolve(response({ data: { session: { accessLevel: 'ORDER_ENABLED' } } }));
      if (url === '/api/v1/table-sessions/current/join-code')
        return Promise.resolve(response({ error: { code: 'JOIN_CODE_HOST_ACCESS_DENIED' } }, 403));
      return Promise.reject(new Error(`Unhandled ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<PublicMenuExperience publicId={publicId} />);

    await screen.findByRole('heading', { name: 'Tham gia bàn bằng mã mời' });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm Cơm gà vào giỏ nháp' }));
    fireEvent.change(screen.getByLabelText('Join Code'), { target: { value: '482193' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tham gia bàn' }));
    await screen.findByText('Đã cấp quyền tại bàn');
    fireEvent.click(screen.getByRole('button', { name: /Giỏ nháp/ }));
    expect(screen.getByText('Cơm gà')).toBeDefined();
    const joinCall = fetchMock.mock.calls.find((call) => call[0] === '/api/v1/table-sessions/join');
    expect(joinCall?.[1]).toMatchObject({
      headers: { 'Idempotency-Key': 'join-key', 'X-CSRF-Token': 'guest-csrf' },
      body: JSON.stringify({ tablePublicId: publicId, joinCode: '482193' }),
    });
  });

  it.each([502, 504])(
    'reuses the Join operation key after an ambiguous HTTP %s',
    async (status) => {
      const randomUUID = vi
        .fn()
        .mockReturnValueOnce('join-key-original')
        .mockReturnValueOnce('join-key-new');
      vi.stubGlobal('crypto', { randomUUID });
      const fetchMock = joinScenario([
        () => Promise.resolve(response({ error: { code: 'UPSTREAM_FAILURE' } }, status)),
        () => Promise.resolve(joinSuccess()),
      ]);
      vi.stubGlobal('fetch', fetchMock);
      render(<PublicMenuExperience publicId={publicId} />);

      await submitJoin();
      await screen.findByText('Chưa thể tham gia bàn. Vui lòng thử lại.');
      fireEvent.click(screen.getByRole('button', { name: 'Tham gia bàn' }));
      await screen.findByText('Đã cấp quyền tại bàn');

      const joinCalls = fetchMock.mock.calls.filter(
        ([url, init]) => url === '/api/v1/table-sessions/join' && init?.method === 'POST',
      );
      expect(
        joinCalls.map(([, init]) => (init?.headers as Record<string, string>)['Idempotency-Key']),
      ).toEqual(['join-key-original', 'join-key-original']);
      expect(randomUUID).toHaveBeenCalledTimes(1);
    },
  );

  it('reuses the Join operation key after a network failure', async () => {
    const randomUUID = vi
      .fn()
      .mockReturnValueOnce('network-key-original')
      .mockReturnValueOnce('network-key-new');
    vi.stubGlobal('crypto', { randomUUID });
    const fetchMock = joinScenario([
      () => Promise.reject(new Error('connection reset')),
      () => Promise.resolve(joinSuccess()),
    ]);
    vi.stubGlobal('fetch', fetchMock);
    render(<PublicMenuExperience publicId={publicId} />);

    await submitJoin();
    await screen.findByText(/Kết nối bị gián đoạn/);
    fireEvent.click(screen.getByRole('button', { name: 'Tham gia bàn' }));
    await screen.findByText('Đã cấp quyền tại bàn');

    const joinCalls = fetchMock.mock.calls.filter(
      ([url, init]) => url === '/api/v1/table-sessions/join' && init?.method === 'POST',
    );
    expect(
      joinCalls.map(([, init]) => (init?.headers as Record<string, string>)['Idempotency-Key']),
    ).toEqual(['network-key-original', 'network-key-original']);
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });

  it('recovers guest CSRF once without changing the Join operation key', async () => {
    const randomUUID = vi.fn().mockReturnValue('csrf-join-key');
    vi.stubGlobal('crypto', { randomUUID });
    const fetchMock = joinScenario([
      () => Promise.resolve(response({ error: { code: 'GUEST_CSRF_INVALID' } }, 403)),
      () => Promise.resolve(joinSuccess()),
    ]);
    vi.stubGlobal('fetch', fetchMock);
    render(<PublicMenuExperience publicId={publicId} />);

    await submitJoin();
    await screen.findByText('Đã cấp quyền tại bàn');

    const joinCalls = fetchMock.mock.calls.filter(
      ([url, init]) => url === '/api/v1/table-sessions/join' && init?.method === 'POST',
    );
    expect(joinCalls).toHaveLength(2);
    expect(
      joinCalls.map(([, init]) => (init?.headers as Record<string, string>)['Idempotency-Key']),
    ).toEqual(['csrf-join-key', 'csrf-join-key']);
    expect(
      joinCalls.map(([, init]) => (init?.headers as Record<string, string>)['X-CSRF-Token']),
    ).toEqual(['guest-csrf', 'recovered-csrf']);
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });

  it('shows plaintext only after explicit Host generation and confirms replacement', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'invite-key' });
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/public/tables/')) return Promise.resolve(response({ data: table }));
      if (url.includes('/public/menu')) return Promise.resolve(response({ data: menu }));
      if (url === '/api/v1/guest-sessions' && init?.method === 'POST')
        return Promise.resolve(bootstrap('ORDER_ENABLED'));
      if (url === '/api/v1/activation-requests/current')
        return Promise.resolve(response({ data: { status: 'APPROVED' } }));
      if (url === '/api/v1/table-sessions/current/join-code' && !init?.method)
        return Promise.resolve(
          response({
            data: {
              hasActiveCode: true,
              expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
              tableSessionVersion: 2,
            },
          }),
        );
      if (url === '/api/v1/table-sessions/current/join-code' && init?.method === 'POST')
        return Promise.resolve(
          response({
            data: {
              code: '654321',
              plaintextAvailable: true,
              hasActiveCode: true,
              expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
              tableSessionVersion: 3,
            },
          }),
        );
      return Promise.reject(new Error(`Unhandled ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<PublicMenuExperience publicId={publicId} />);

    expect(await screen.findByText(/mã cũ không được lưu/)).toBeDefined();
    expect(screen.queryByText('654321')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tạo Join Code mới' }));
    expect(await screen.findByText('654321')).toBeDefined();
    expect(window.confirm).toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (entry) =>
          entry[0] === '/api/v1/table-sessions/current/join-code' && entry[1]?.method === 'POST',
      );
      expect(call?.[1]?.body).toBe(JSON.stringify({ expectedVersion: 2, replaceExisting: true }));
    });
  });
});
