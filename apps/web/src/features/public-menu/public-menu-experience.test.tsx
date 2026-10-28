import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PublicMenuExperience } from './public-menu-experience';

const tableResponse = {
  data: {
    publicId: '31000000-0000-4000-8000-000000000001',
    restaurantName: 'Bếp Mây Demo',
    locationName: 'Chi nhánh Demo',
    tableLabel: 'A01',
    capacity: 2,
    availability: 'AVAILABLE',
  },
};

const menuResponse = {
  data: {
    currency: 'VND',
    categories: [
      {
        id: 'category-1',
        name: 'Món Việt',
        items: [
          {
            id: 'item-1',
            name: 'Cơm gà lá chanh',
            description: 'Cơm thơm và gà áp chảo.',
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

function mockResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: vi.fn().mockResolvedValue(body) };
}

function mockSuccessfulLoad() {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(mockResponse(tableResponse))
      .mockResolvedValueOnce(mockResponse(menuResponse)),
  );
}

function guestBootstrapResponse(csrfToken = 'test-csrf-token') {
  return mockResponse({
    data: {
      table: tableResponse.data,
      activationState: 'NOT_REQUESTED',
      session: {
        accessLevel: 'BROWSE_ONLY',
        idleExpiresAt: new Date(Date.now() + 1800000).toISOString(),
        absoluteExpiresAt: new Date(Date.now() + 28800000).toISOString(),
      },
      csrfToken,
    },
  });
}

describe('PublicMenuExperience', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('loads table/menu context and keeps draft cart state across views', async () => {
    mockSuccessfulLoad();
    render(<PublicMenuExperience publicId={tableResponse.data.publicId} />);

    expect(screen.getByText('Đang mở thực đơn…')).toBeDefined();
    expect(await screen.findByText('Bếp Mây Demo')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Thêm Cơm gà lá chanh vào giỏ nháp' }));
    fireEvent.click(screen.getByRole('button', { name: /Giỏ nháp/ }));

    expect(screen.getByRole('heading', { name: 'Giỏ nháp của bạn' })).toBeDefined();
    expect(screen.getByLabelText('Số lượng hiện tại: 1')).toBeDefined();
    expect(screen.getAllByText(/79\.000/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Tăng Cơm gà lá chanh' }));
    expect(screen.getByLabelText('Số lượng hiện tại: 2')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Thêm món khác' }));
    fireEvent.click(screen.getByRole('button', { name: /Giỏ nháp/ }));
    expect(screen.getByLabelText('Số lượng hiện tại: 2')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Xóa' }));
    expect(screen.getByText('Giỏ nháp đang trống')).toBeDefined();
  });

  it('shows a safe invalid-table state', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(mockResponse({ error: {} }, 404))
        .mockResolvedValueOnce(mockResponse({ error: {} }, 404)),
    );

    render(<PublicMenuExperience publicId="unknown" />);
    expect(await screen.findByText('Mã QR này không còn hợp lệ')).toBeDefined();
  });

  it('shows empty and API-error states', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(mockResponse(tableResponse))
        .mockResolvedValueOnce(mockResponse({ data: { currency: 'VND', categories: [] } })),
    );
    const { unmount } = render(<PublicMenuExperience publicId={tableResponse.data.publicId} />);
    expect(await screen.findByText('Thực đơn đang được cập nhật')).toBeDefined();
    unmount();

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(mockResponse({ error: {} }, 503))
        .mockResolvedValueOnce(mockResponse({ error: {} }, 503)),
    );
    render(<PublicMenuExperience publicId={tableResponse.data.publicId} />);
    await waitFor(() => expect(screen.getByText('Chưa thể tải thực đơn')).toBeDefined());
  });

  it('triggers guest bootstrap when table context loads successfully', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/v1/public/tables/')) {
        return Promise.resolve(mockResponse(tableResponse));
      }
      if (url.includes('/api/v1/public/menu')) {
        return Promise.resolve(mockResponse(menuResponse));
      }
      if (url.includes('/api/v1/guest-sessions')) {
        return Promise.resolve(
          mockResponse({
            data: {
              table: tableResponse.data,
              activationState: 'NOT_REQUESTED',
              session: {
                accessLevel: 'BROWSE_ONLY',
                idleExpiresAt: new Date(Date.now() + 1800000).toISOString(),
                absoluteExpiresAt: new Date(Date.now() + 28800000).toISOString(),
              },
              csrfToken: 'test-csrf-token',
            },
          }),
        );
      }
      return Promise.reject(new Error(`Unhandled url: ${url}`));
    });

    vi.stubGlobal('fetch', fetchMock);

    render(<PublicMenuExperience publicId={tableResponse.data.publicId} />);
    expect(await screen.findByText('Bếp Mây Demo')).toBeDefined();

    await waitFor(() => {
      const bootstrapCall = fetchMock.mock.calls.find(
        (call: unknown[]) =>
          typeof call[0] === 'string' && call[0].includes('/api/v1/guest-sessions'),
      );
      expect(bootstrapCall).toBeDefined();
    });

    const notice = screen.getByRole('note');
    await waitFor(() => {
      expect(notice.getAttribute('data-session-established')).toBe('true');
    });
  });

  it('requests activation explicitly and preserves the local draft cart while waiting', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'activation-key-1' });
    const expiresAt = new Date(Date.now() + 300000).toISOString();
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/v1/public/tables/'))
        return Promise.resolve(mockResponse(tableResponse));
      if (url.includes('/api/v1/public/menu')) return Promise.resolve(mockResponse(menuResponse));
      if (url === '/api/v1/guest-sessions') return Promise.resolve(guestBootstrapResponse());
      if (url === '/api/v1/activation-requests/current') {
        return Promise.resolve(mockResponse({ data: { status: 'NOT_REQUESTED' } }));
      }
      if (url === '/api/v1/activation-requests' && init?.method === 'POST') {
        return Promise.resolve(
          mockResponse(
            {
              data: {
                status: 'PENDING',
                activationRequestId: 'activation-request-1',
                expiresAt,
              },
            },
            202,
          ),
        );
      }
      return Promise.reject(new Error(`Unhandled url: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<PublicMenuExperience publicId={tableResponse.data.publicId} />);
    await screen.findByText('Bếp Mây Demo');
    fireEvent.click(screen.getByRole('button', { name: 'Thêm Cơm gà lá chanh vào giỏ nháp' }));
    const activationButton = await screen.findByRole('button', { name: 'Yêu cầu kích hoạt bàn' });
    await waitFor(() => expect(activationButton.hasAttribute('disabled')).toBe(false));
    fireEvent.click(activationButton);

    expect(await screen.findByText('Đang chờ nhân viên')).toBeDefined();
    const postCall = fetchMock.mock.calls.find(
      (call: unknown[]) =>
        call[0] === '/api/v1/activation-requests' &&
        (call[1] as RequestInit | undefined)?.method === 'POST',
    );
    expect(postCall?.[1]).toMatchObject({
      credentials: 'include',
      headers: {
        'Idempotency-Key': 'activation-key-1',
        'X-CSRF-Token': 'test-csrf-token',
      },
      body: JSON.stringify({ tablePublicId: tableResponse.data.publicId }),
    });

    fireEvent.click(screen.getByRole('button', { name: /Giỏ nháp/ }));
    expect(screen.getByLabelText('Số lượng hiện tại: 1')).toBeDefined();
  });

  it('recovers a stale guest CSRF token and retries with the same idempotency key', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'activation-key-recovery' });
    let postCount = 0;
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/v1/public/tables/'))
        return Promise.resolve(mockResponse(tableResponse));
      if (url.includes('/api/v1/public/menu')) return Promise.resolve(mockResponse(menuResponse));
      if (url === '/api/v1/guest-sessions')
        return Promise.resolve(guestBootstrapResponse('stale-token'));
      if (url === '/api/v1/activation-requests/current') {
        return Promise.resolve(mockResponse({ data: { status: 'NOT_REQUESTED' } }));
      }
      if (url === '/api/v1/guest-sessions/csrf-token') {
        return Promise.resolve(mockResponse({ data: { csrfToken: 'fresh-token' } }));
      }
      if (url === '/api/v1/activation-requests' && init?.method === 'POST') {
        postCount += 1;
        return Promise.resolve(
          postCount === 1
            ? mockResponse({ error: { code: 'GUEST_CSRF_INVALID' } }, 403)
            : mockResponse(
                {
                  data: {
                    status: 'PENDING',
                    expiresAt: new Date(Date.now() + 300000).toISOString(),
                  },
                },
                200,
              ),
        );
      }
      return Promise.reject(new Error(`Unhandled url: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<PublicMenuExperience publicId={tableResponse.data.publicId} />);
    const activationButton = await screen.findByRole('button', { name: 'Yêu cầu kích hoạt bàn' });
    await waitFor(() => expect(activationButton.hasAttribute('disabled')).toBe(false));
    fireEvent.click(activationButton);
    expect(await screen.findByText('Đang chờ nhân viên')).toBeDefined();

    const postCalls = fetchMock.mock.calls.filter(
      (call: unknown[]) =>
        call[0] === '/api/v1/activation-requests' &&
        (call[1] as RequestInit | undefined)?.method === 'POST',
    );
    expect(postCalls).toHaveLength(2);
    expect((postCalls[0]?.[1] as RequestInit).headers).toMatchObject({
      'Idempotency-Key': 'activation-key-recovery',
      'X-CSRF-Token': 'stale-token',
    });
    expect((postCalls[1]?.[1] as RequestInit).headers).toMatchObject({
      'Idempotency-Key': 'activation-key-recovery',
      'X-CSRF-Token': 'fresh-token',
    });
  });

  it('restores a generic waiting state from the read-only activation poll', async () => {
    const expiresAt = new Date(Date.now() + 300000).toISOString();
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/v1/public/tables/'))
        return Promise.resolve(mockResponse(tableResponse));
      if (url.includes('/api/v1/public/menu')) return Promise.resolve(mockResponse(menuResponse));
      if (url === '/api/v1/guest-sessions') return Promise.resolve(guestBootstrapResponse());
      if (url === '/api/v1/activation-requests/current') {
        return Promise.resolve(mockResponse({ data: { status: 'PENDING', expiresAt } }));
      }
      return Promise.reject(new Error(`Unhandled url: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<PublicMenuExperience publicId={tableResponse.data.publicId} />);
    expect(await screen.findByText('Đang chờ nhân viên')).toBeDefined();
    expect(screen.getByText(/Nhân viên đang xác nhận yêu cầu/)).toBeDefined();
    const pollCall = fetchMock.mock.calls.find(
      (call: unknown[]) => call[0] === '/api/v1/activation-requests/current',
    );
    expect(pollCall?.[1]).toMatchObject({ credentials: 'include' });
  });
});
