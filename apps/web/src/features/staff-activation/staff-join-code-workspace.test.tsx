import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StaffActivationWorkspace } from './staff-activation-workspace';

function response(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: vi.fn().mockResolvedValue(body) };
}

describe('staff Join Code controls', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('lists scoped active sessions and rotates a code only after confirmation', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'staff-join-key' });
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    const staff = {
      id: 'staff-1',
      email: 'waiter@example.test',
      name: 'Waiter',
      membershipId: 'membership-1',
      restaurantId: 'restaurant-1',
      locationId: 'location-1',
      permissions: ['table.activation.read', 'table.session.read', 'table.join_code.manage'],
    };
    const activeSession = {
      id: 'session-1',
      version: 4,
      activatedAt: new Date().toISOString(),
      table: { publicId: 'table-1', code: 'A01', capacity: 4 },
      joinCode: { hasActiveCode: true, expiresAt: new Date(Date.now() + 600_000).toISOString() },
    };
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/staff/auth/me') return Promise.resolve(response({ data: { staff } }));
      if (url === '/api/v1/staff/auth/csrf-token')
        return Promise.resolve(response({ data: { csrfToken: 'staff-csrf' } }));
      if (url === '/api/v1/staff/activation-requests?status=PENDING')
        return Promise.resolve(response({ data: [] }));
      if (url === '/api/v1/staff/table-sessions?status=ACTIVE')
        return Promise.resolve(response({ data: [activeSession] }));
      if (url === '/api/v1/staff/table-sessions/session-1/join-code' && init?.method === 'POST')
        return Promise.resolve(response({ data: { code: '112233' } }));
      return Promise.reject(new Error(`Unhandled ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<StaffActivationWorkspace />);

    expect(await screen.findByRole('heading', { name: 'Phiên bàn đang hoạt động' })).toBeDefined();
    fireEvent.click(await screen.findByRole('button', { name: 'Tạo mã thay thế' }));
    expect(await screen.findByText('112233')).toBeDefined();
    expect(window.confirm).toHaveBeenCalled();
    const call = fetchMock.mock.calls.find(
      (entry) => entry[0] === '/api/v1/staff/table-sessions/session-1/join-code',
    );
    expect(call?.[1]).toMatchObject({
      method: 'POST',
      headers: { 'Idempotency-Key': 'staff-join-key', 'X-CSRF-Token': 'staff-csrf' },
      body: JSON.stringify({ expectedVersion: 4, replaceExisting: true }),
    });
  });
});
