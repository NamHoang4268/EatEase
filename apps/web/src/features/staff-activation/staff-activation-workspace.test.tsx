import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StaffActivationWorkspace } from './staff-activation-workspace';

const staff = {
  id: 'staff-1',
  email: 'waiter@example.test',
  name: 'Nhân viên Demo',
  membershipId: 'membership-1',
  restaurantId: 'restaurant-1',
  locationId: 'location-1',
  permissions: ['table.activation.read', 'table.activation.approve'],
};

const pendingRequest = {
  id: 'activation-1',
  status: 'PENDING',
  createdAt: new Date(Date.now() - 60_000).toISOString(),
  expiresAt: new Date(Date.now() + 240_000).toISOString(),
  version: 3,
  table: { publicId: 'table-public-1', code: 'A01', capacity: 4 },
};

function mockResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: vi.fn().mockResolvedValue(body) };
}

function restoredSessionFetch(queue = [pendingRequest]) {
  return vi.fn().mockImplementation((url: string) => {
    if (url === '/api/v1/staff/auth/me') {
      return Promise.resolve(mockResponse({ data: { staff } }));
    }
    if (url === '/api/v1/staff/auth/csrf-token') {
      return Promise.resolve(mockResponse({ data: { csrfToken: 'staff-csrf' } }));
    }
    if (url === '/api/v1/staff/activation-requests?status=PENDING') {
      return Promise.resolve(mockResponse({ data: queue }));
    }
    return Promise.reject(new Error(`Unhandled URL: ${url}`));
  });
}

describe('StaffActivationWorkspace', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('restores a staff session and renders its location-scoped pending queue', async () => {
    vi.stubGlobal('fetch', restoredSessionFetch());
    render(<StaffActivationWorkspace />);

    expect(screen.getByText('Đang kiểm tra phiên…')).toBeDefined();
    expect(await screen.findByRole('heading', { name: 'Yêu cầu kích hoạt bàn' })).toBeDefined();
    expect(await screen.findByRole('heading', { name: 'Bàn A01' })).toBeDefined();
    expect(screen.getByText(/phạm vi địa điểm location-1/)).toBeDefined();
  });

  it('shows login for a missing session and authenticates without storing credentials', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/staff/auth/me') {
        return Promise.resolve(mockResponse({ error: { code: 'STAFF_SESSION_INVALID' } }, 401));
      }
      if (url === '/api/v1/staff/auth/login' && init?.method === 'POST') {
        return Promise.resolve(mockResponse({ data: { staff, csrfToken: 'login-csrf' } }));
      }
      if (url === '/api/v1/staff/activation-requests?status=PENDING') {
        return Promise.resolve(mockResponse({ data: [] }));
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<StaffActivationWorkspace />);

    expect(await screen.findByRole('heading', { name: 'Đăng nhập vận hành' })).toBeDefined();
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'waiter@example.test' },
    });
    fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'not-persisted' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Đăng nhập' }).closest('form')!);

    expect(await screen.findByText('Không có yêu cầu đang chờ')).toBeDefined();
    const loginCall = fetchMock.mock.calls.find(
      (call: unknown[]) => call[0] === '/api/v1/staff/auth/login',
    );
    expect(loginCall?.[1]).toMatchObject({
      credentials: 'include',
      body: JSON.stringify({ email: 'waiter@example.test', password: 'not-persisted' }),
    });
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('requires physical-presence confirmation and sends approved decision contracts', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'staff-decision-key' });
    const fetchMock = restoredSessionFetch();
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/staff/auth/me') {
        return Promise.resolve(mockResponse({ data: { staff } }));
      }
      if (url === '/api/v1/staff/auth/csrf-token') {
        return Promise.resolve(mockResponse({ data: { csrfToken: 'staff-csrf' } }));
      }
      if (url === '/api/v1/staff/activation-requests?status=PENDING') {
        return Promise.resolve(mockResponse({ data: [pendingRequest] }));
      }
      if (url.endsWith('/approve') && init?.method === 'POST') {
        return Promise.resolve(
          mockResponse({ data: { activationRequest: { status: 'APPROVED' } } }),
        );
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<StaffActivationWorkspace />);

    const approveButton = await screen.findByRole('button', { name: 'Duyệt kích hoạt' });
    expect(approveButton.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByLabelText(/Tôi đã trực tiếp xác nhận/));
    expect(approveButton.hasAttribute('disabled')).toBe(false);
    fireEvent.click(approveButton);

    await screen.findByText('Đã kích hoạt bàn A01.');
    const approveCall = fetchMock.mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'string' && call[0].endsWith('/approve'),
    );
    expect(approveCall?.[1]).toMatchObject({
      credentials: 'include',
      headers: {
        'Idempotency-Key': 'staff-decision-key',
        'X-CSRF-Token': 'staff-csrf',
      },
      body: JSON.stringify({ expectedVersion: 3, physicalPresenceConfirmed: true }),
    });
  });

  it('validates and submits a rejection reason with version and idempotency', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'staff-reject-key' });
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/staff/auth/me')
        return Promise.resolve(mockResponse({ data: { staff } }));
      if (url === '/api/v1/staff/auth/csrf-token')
        return Promise.resolve(mockResponse({ data: { csrfToken: 'staff-csrf' } }));
      if (url === '/api/v1/staff/activation-requests?status=PENDING')
        return Promise.resolve(mockResponse({ data: [pendingRequest] }));
      if (url.endsWith('/reject') && init?.method === 'POST')
        return Promise.resolve(
          mockResponse({ data: { activationRequest: { status: 'REJECTED' } } }),
        );
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<StaffActivationWorkspace />);

    const rejectButton = await screen.findByRole('button', { name: 'Từ chối' });
    expect(rejectButton.hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText('Lý do từ chối'), {
      target: { value: 'Không có khách tại bàn' },
    });
    fireEvent.click(rejectButton);
    await screen.findByText('Đã từ chối yêu cầu tại bàn A01.');

    const rejectCall = fetchMock.mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'string' && call[0].endsWith('/reject'),
    );
    expect(rejectCall?.[1]).toMatchObject({
      headers: { 'Idempotency-Key': 'staff-reject-key', 'X-CSRF-Token': 'staff-csrf' },
      body: JSON.stringify({ expectedVersion: 3, reason: 'Không có khách tại bàn' }),
    });
  });

  it('shows a scoped authorization error without exposing queue data', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/v1/staff/auth/me')
        return Promise.resolve(mockResponse({ data: { staff } }));
      if (url === '/api/v1/staff/auth/csrf-token')
        return Promise.resolve(mockResponse({ data: { csrfToken: 'staff-csrf' } }));
      if (url === '/api/v1/staff/activation-requests?status=PENDING')
        return Promise.resolve(
          mockResponse({ error: { code: 'STAFF_AUTHORIZATION_DENIED' } }, 403),
        );
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<StaffActivationWorkspace />);

    expect(
      await screen.findByText('Bạn không có quyền xem yêu cầu kích hoạt tại địa điểm này.'),
    ).toBeDefined();
    expect(screen.queryByRole('heading', { name: 'Bàn A01' })).toBeNull();
  });

  it('handles queue errors, stale decisions, session expiry, and safe network retries', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'stable-retry-key' });
    let queueCount = 0;
    let approveCount = 0;
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/staff/auth/me')
        return Promise.resolve(mockResponse({ data: { staff } }));
      if (url === '/api/v1/staff/auth/csrf-token')
        return Promise.resolve(mockResponse({ data: { csrfToken: 'staff-csrf' } }));
      if (url === '/api/v1/staff/activation-requests?status=PENDING') {
        queueCount += 1;
        return Promise.resolve(
          queueCount === 1
            ? mockResponse({ error: { code: 'TEMPORARY' } }, 503)
            : mockResponse({ data: [pendingRequest] }),
        );
      }
      if (url.endsWith('/approve') && init?.method === 'POST') {
        approveCount += 1;
        if (approveCount === 1) return Promise.reject(new Error('network lost'));
        if (approveCount === 2)
          return Promise.resolve(
            mockResponse({ error: { code: 'ACTIVATION_VERSION_CONFLICT' } }, 409),
          );
        return Promise.resolve(mockResponse({ error: { code: 'STAFF_SESSION_INVALID' } }, 401));
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<StaffActivationWorkspace />);

    expect(await screen.findByText('Chưa thể tải hàng chờ')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    const approveButton = await screen.findByRole('button', { name: 'Duyệt kích hoạt' });
    fireEvent.click(screen.getByLabelText(/Tôi đã trực tiếp xác nhận/));
    fireEvent.click(approveButton);
    expect(await screen.findByText(/Kết nối bị gián đoạn/)).toBeDefined();
    fireEvent.click(approveButton);
    expect(await screen.findByText(/Yêu cầu đã thay đổi hoặc hết hạn/)).toBeDefined();

    const approveCalls = fetchMock.mock.calls.filter(
      (call: unknown[]) => typeof call[0] === 'string' && call[0].endsWith('/approve'),
    );
    expect(approveCalls).toHaveLength(2);
    expect((approveCalls[0]?.[1] as RequestInit).headers).toMatchObject({
      'Idempotency-Key': 'stable-retry-key',
    });
    expect((approveCalls[1]?.[1] as RequestInit).headers).toMatchObject({
      'Idempotency-Key': 'stable-retry-key',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Duyệt kích hoạt' }));
    expect(await screen.findByText(/Phiên nhân viên đã hết hạn/)).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Đăng nhập vận hành' })).toBeDefined();
  });
});
