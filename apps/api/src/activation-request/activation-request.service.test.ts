import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../database/prisma.service.js';
import { ActivationRequestStatus, GuestAccessLevel } from '../generated/prisma/enums.js';
import type { GuestPrincipal } from '../guest-session/guest-session.types.js';
import type { StaffPrincipal } from '../staff-auth/staff-auth.types.js';
import { ActivationRequestService } from './activation-request.service.js';

const guest: GuestPrincipal = {
  sessionId: 'guest-1',
  restaurantId: 'restaurant-1',
  locationId: 'location-1',
  tableId: 'table-1',
  tablePublicId: '31000000-0000-4000-8000-000000000001',
  accessLevel: GuestAccessLevel.BROWSE_ONLY,
  idleExpiresAt: new Date('2026-10-28T10:30:00.000Z'),
  absoluteExpiresAt: new Date('2026-10-28T18:00:00.000Z'),
  csrfTokenHash: 'a'.repeat(64),
};

const staff: StaffPrincipal = {
  sessionId: 'staff-session-1',
  staffUserId: 'staff-1',
  membershipId: 'membership-1',
  restaurantId: 'restaurant-1',
  locationId: 'location-1',
  email: 'staff@example.test',
  name: 'Staff',
  permissions: ['table.activation.read'],
  csrfTokenHash: 'b'.repeat(64),
};

describe('ActivationRequestService read models', () => {
  const findFirst = vi.fn();
  const findMany = vi.fn();
  const prisma = {
    activationRequest: { findFirst, findMany },
  } as unknown as PrismaService;
  const service = new ActivationRequestService(prisma);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a generic pending state to a different guest device', async () => {
    findFirst.mockResolvedValueOnce({
      id: 'private-request-id',
      requesterGuestSessionId: 'another-device',
      expiresAt: new Date('2026-10-28T10:05:00.000Z'),
    });

    await expect(service.getCurrent(guest, new Date('2026-10-28T10:00:00.000Z'))).resolves.toEqual({
      status: 'PENDING',
      expiresAt: '2026-10-28T10:05:00.000Z',
    });
  });

  it('projects an expired request without issuing a database write', async () => {
    findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'own-request-id',
      status: ActivationRequestStatus.PENDING,
      expiresAt: new Date('2026-10-28T09:59:00.000Z'),
    });

    await expect(service.getCurrent(guest, new Date('2026-10-28T10:00:00.000Z'))).resolves.toEqual({
      status: 'EXPIRED',
      activationRequestId: 'own-request-id',
      expiresAt: '2026-10-28T09:59:00.000Z',
    });
    expect(findFirst).toHaveBeenCalledTimes(2);
  });

  it('derives the staff queue scope from the authenticated principal', async () => {
    findMany.mockResolvedValueOnce([]);
    await expect(
      service.getStaffQueue(
        { status: 'PENDING', principal: staff },
        new Date('2026-10-28T10:00:00.000Z'),
      ),
    ).resolves.toEqual([]);
    const query = findMany.mock.calls[0]?.[0] as unknown as {
      where: { restaurantId: string; locationId: string; status: ActivationRequestStatus };
    };
    expect(query.where).toMatchObject({
      restaurantId: 'restaurant-1',
      locationId: 'location-1',
      status: ActivationRequestStatus.PENDING,
    });
  });
});
