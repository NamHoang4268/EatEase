import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { GuestCookieService } from '../guest-session/guest-cookie.service.js';
import type { GuestRequest } from '../guest-session/guest-session.types.js';
import type { OriginPolicyService } from '../staff-auth/origin-policy.service.js';
import type { StaffRequest } from '../staff-auth/staff-auth.types.js';
import { GuestJoinCodeController, StaffJoinCodeController } from './join-code.controller.js';
import type { JoinCodeService } from './join-code.service.js';

const guestPrincipal = {
  sessionId: 'guest-1',
  restaurantId: 'restaurant-1',
  locationId: 'location-1',
  tableId: 'table-1',
  tablePublicId: '31000000-0000-4000-8000-000000000001',
  accessLevel: 'ORDER_ENABLED' as const,
  idleExpiresAt: new Date(),
  absoluteExpiresAt: new Date(),
  csrfTokenHash: 'hash',
};

const staffPrincipal = {
  sessionId: 'staff-session-1',
  staffUserId: 'staff-1',
  membershipId: 'membership-1',
  restaurantId: 'restaurant-1',
  locationId: 'location-1',
  email: 'staff@example.test',
  name: 'Staff',
  permissions: ['table.join_code.manage'],
  csrfTokenHash: 'hash',
};

describe('Join Code controllers', () => {
  it('forwards the exact Host issue contract', async () => {
    const service = { issueForHost: vi.fn().mockResolvedValue({ code: '123456' }) };
    const controller = new GuestJoinCodeController(
      service as unknown as JoinCodeService,
      {} as GuestCookieService,
      {} as OriginPolicyService,
    );
    const result = await controller.issue(
      { expectedVersion: 2, replaceExisting: true },
      'host-key',
      { guestPrincipal } as GuestRequest,
    );
    expect(result).toEqual({ data: { code: '123456' } });
    expect(service.issueForHost).toHaveBeenCalledWith({
      expectedVersion: 2,
      replaceExisting: true,
      idempotencyKey: 'host-key',
      principal: guestPrincipal,
    });
  });

  it('rejects malformed Join Codes before service execution', async () => {
    const controller = new GuestJoinCodeController(
      {} as JoinCodeService,
      {} as GuestCookieService,
      { assertTrusted: vi.fn() } as unknown as OriginPolicyService,
    );
    await expect(
      controller.join(
        { tablePublicId: guestPrincipal.tablePublicId, joinCode: '12345' },
        'join-key',
        { headers: {}, ip: '127.0.0.1' } as never,
        {} as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('forwards staff scope and optimistic version to rotation', async () => {
    const service = { issueForStaff: vi.fn().mockResolvedValue({ code: '654321' }) };
    const controller = new StaffJoinCodeController(service as unknown as JoinCodeService);
    await controller.issue(
      '51000000-0000-4000-8000-000000000001',
      { expectedVersion: 4, replaceExisting: false },
      'staff-key',
      { staffPrincipal } as unknown as StaffRequest,
    );
    expect(service.issueForStaff).toHaveBeenCalledWith({
      tableSessionId: '51000000-0000-4000-8000-000000000001',
      expectedVersion: 4,
      replaceExisting: false,
      idempotencyKey: 'staff-key',
      principal: staffPrincipal,
    });
  });
});
