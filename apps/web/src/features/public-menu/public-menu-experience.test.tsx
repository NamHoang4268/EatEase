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
    window.sessionStorage.clear();
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

  it.each([
    ['REJECTED', 'Yêu cầu chưa được chấp nhận'],
    ['EXPIRED', 'Yêu cầu trước đã hết hạn'],
    ['CANCELLED', 'Yêu cầu kích hoạt đã được hủy'],
  ] as const)(
    'renders the %s activation state without claiming automatically',
    async (status, copy) => {
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/v1/public/tables/'))
          return Promise.resolve(mockResponse(tableResponse));
        if (url.includes('/api/v1/public/menu')) return Promise.resolve(mockResponse(menuResponse));
        if (url === '/api/v1/guest-sessions') return Promise.resolve(guestBootstrapResponse());
        if (url === '/api/v1/activation-requests/current') {
          return Promise.resolve(mockResponse({ data: { status } }));
        }
        return Promise.reject(new Error(`Unhandled url: ${url}`));
      });
      vi.stubGlobal('fetch', fetchMock);

      render(<PublicMenuExperience publicId={tableResponse.data.publicId} />);
      expect(await screen.findByText(new RegExp(copy))).toBeDefined();
      expect(
        fetchMock.mock.calls.some(
          (call: unknown[]) => call[0] === '/api/v1/activation-requests/current/claim',
        ),
      ).toBe(false);
    },
  );

  it('claims only after explicit action, refreshes the session, and preserves the draft cart', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'claim-key-1' });
    let activationReadCount = 0;
    const approvedState = {
      status: 'APPROVED',
      activationRequestId: 'activation-request-1',
      version: 1,
      claimAvailable: true,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    };
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/v1/public/tables/'))
        return Promise.resolve(mockResponse(tableResponse));
      if (url.includes('/api/v1/public/menu')) return Promise.resolve(mockResponse(menuResponse));
      if (url === '/api/v1/guest-sessions') return Promise.resolve(guestBootstrapResponse());
      if (url === '/api/v1/activation-requests/current') {
        activationReadCount += 1;
        return Promise.resolve(
          mockResponse({
            data:
              activationReadCount === 1
                ? approvedState
                : { ...approvedState, claimAvailable: undefined },
          }),
        );
      }
      if (url === '/api/v1/activation-requests/current/claim' && init?.method === 'POST') {
        return Promise.resolve(
          mockResponse({
            data: {
              session: {
                accessLevel: 'ORDER_ENABLED',
                tableSessionId: 'table-session-1',
                version: 1,
              },
              csrfToken: 'rotated-csrf',
            },
          }),
        );
      }
      if (url === '/api/v1/guest-sessions/current') {
        return Promise.resolve(
          mockResponse({ data: { session: { accessLevel: 'ORDER_ENABLED' } } }),
        );
      }
      return Promise.reject(new Error(`Unhandled url: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<PublicMenuExperience publicId={tableResponse.data.publicId} />);
    await screen.findByText('Bếp Mây Demo');
    fireEvent.click(screen.getByRole('button', { name: 'Thêm Cơm gà lá chanh vào giỏ nháp' }));
    const claimButton = await screen.findByRole('button', {
      name: 'Tiếp tục với bàn đã kích hoạt',
    });
    expect(
      fetchMock.mock.calls.some(
        (call: unknown[]) => call[0] === '/api/v1/activation-requests/current/claim',
      ),
    ).toBe(false);
    fireEvent.click(claimButton);

    expect(await screen.findByText('Đã cấp quyền tại bàn')).toBeDefined();
    const claimCall = fetchMock.mock.calls.find(
      (call: unknown[]) => call[0] === '/api/v1/activation-requests/current/claim',
    );
    expect(claimCall?.[1]).toMatchObject({
      credentials: 'include',
      headers: {
        'Idempotency-Key': 'claim-key-1',
        'X-CSRF-Token': 'test-csrf-token',
      },
      body: JSON.stringify({ expectedVersion: 1 }),
    });
    expect(window.sessionStorage.length).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: /Giỏ nháp/ }));
    expect(screen.getByLabelText('Số lượng hiện tại: 1')).toBeDefined();
    expect(screen.getByText('Chưa thể gửi món trong giai đoạn này')).toBeDefined();
  });

  it('reuses the bounded claim idempotency key after an uncertain response', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'claim-recovery-key' });
    let claimCount = 0;
    const approvedState = {
      status: 'APPROVED',
      activationRequestId: 'activation-request-recovery',
      version: 1,
      claimAvailable: true,
    };
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/v1/public/tables/'))
        return Promise.resolve(mockResponse(tableResponse));
      if (url.includes('/api/v1/public/menu')) return Promise.resolve(mockResponse(menuResponse));
      if (url === '/api/v1/guest-sessions') return Promise.resolve(guestBootstrapResponse());
      if (url === '/api/v1/activation-requests/current')
        return Promise.resolve(mockResponse({ data: approvedState }));
      if (url === '/api/v1/activation-requests/current/claim' && init?.method === 'POST') {
        claimCount += 1;
        return claimCount === 1
          ? Promise.reject(new Error('response lost'))
          : Promise.resolve(
              mockResponse({
                data: {
                  session: {
                    accessLevel: 'ORDER_ENABLED',
                    tableSessionId: 'table-session-1',
                    version: 1,
                  },
                  csrfToken: 'recovered-csrf',
                },
              }),
            );
      }
      if (url === '/api/v1/guest-sessions/current')
        return Promise.resolve(
          mockResponse({ data: { session: { accessLevel: 'ORDER_ENABLED' } } }),
        );
      return Promise.reject(new Error(`Unhandled url: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<PublicMenuExperience publicId={tableResponse.data.publicId} />);

    const claimButton = await screen.findByRole('button', {
      name: 'Tiếp tục với bàn đã kích hoạt',
    });
    fireEvent.click(claimButton);
    expect(await screen.findByText(/Phản hồi bị gián đoạn/)).toBeDefined();
    expect(window.sessionStorage.length).toBe(1);
    fireEvent.click(claimButton);
    expect(await screen.findByText('Đã cấp quyền tại bàn')).toBeDefined();

    const claimCalls = fetchMock.mock.calls.filter(
      (call: unknown[]) => call[0] === '/api/v1/activation-requests/current/claim',
    );
    expect(claimCalls).toHaveLength(2);
    expect((claimCalls[0]?.[1] as RequestInit).headers).toMatchObject({
      'Idempotency-Key': 'claim-recovery-key',
    });
    expect((claimCalls[1]?.[1] as RequestInit).headers).toMatchObject({
      'Idempotency-Key': 'claim-recovery-key',
    });
    expect(window.sessionStorage.length).toBe(0);
  });
});
