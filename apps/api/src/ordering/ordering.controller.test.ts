import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { GuestRequest } from '../guest-session/guest-session.types.js';
import type { StaffRequest } from '../staff-auth/staff-auth.types.js';
import { OrderingController } from './ordering.controller.js';
import type { OrderingService } from './ordering.service.js';

const items = [
  {
    menuItemId: '91000000-0000-4000-8000-000000000001',
    quantity: 2,
    modifierSelections: [],
    note: null,
  },
];
const guestPrincipal = {
  sessionId: '92000000-0000-4000-8000-000000000001',
  restaurantId: '93000000-0000-4000-8000-000000000001',
  locationId: '94000000-0000-4000-8000-000000000001',
  tableId: '95000000-0000-4000-8000-000000000001',
  tablePublicId: '96000000-0000-4000-8000-000000000001',
  tableSessionId: '97000000-0000-4000-8000-000000000001',
  accessLevel: 'ORDER_ENABLED' as const,
  idleExpiresAt: new Date(Date.now() + 60_000),
  absoluteExpiresAt: new Date(Date.now() + 120_000),
  csrfTokenHash: 'a'.repeat(64),
};
const staffPrincipal = {
  sessionId: '98000000-0000-4000-8000-000000000001',
  staffUserId: '99000000-0000-4000-8000-000000000001',
  membershipId: '9a000000-0000-4000-8000-000000000001',
  restaurantId: guestPrincipal.restaurantId,
  locationId: guestPrincipal.locationId,
  email: 'waiter@example.test',
  name: 'Waiter',
  permissions: ['order.create_for_table', 'bill.read'],
  csrfTokenHash: 'b'.repeat(64),
};

describe('OrderingController', () => {
  const submitGuest = vi.fn().mockResolvedValue({ order: { id: 'guest-order' } });
  const submitStaff = vi.fn().mockResolvedValue({ order: { id: 'staff-order' } });
  const currentForGuest = vi.fn().mockResolvedValue({ bill: { id: 'bill' } });
  const currentForStaff = vi.fn().mockResolvedValue({ bill: { id: 'bill' } });
  const controller = new OrderingController({
    submitGuest,
    submitStaff,
    currentForGuest,
    currentForStaff,
  } as unknown as OrderingService);

  it('passes only the authenticated guest and validated selections to the shared service', async () => {
    await controller.submitGuest({ items }, 'guest-submit-key', {
      guestPrincipal,
    } as unknown as GuestRequest);
    expect(submitGuest).toHaveBeenCalledWith(guestPrincipal, { items }, 'guest-submit-key');
  });

  it('rejects client-supplied financial fields before persistence', async () => {
    await expect(
      controller.submitGuest({ items, totalAmount: '1' }, 'guest-submit-key', {
        guestPrincipal,
      } as unknown as GuestRequest),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('derives the staff actor from the authenticated principal and validates the target UUID', async () => {
    await controller.submitStaff(guestPrincipal.tableSessionId, { items }, 'staff-submit-key', {
      staffPrincipal,
    } as unknown as StaffRequest);
    expect(submitStaff).toHaveBeenCalledWith(
      staffPrincipal,
      guestPrincipal.tableSessionId,
      { items },
      'staff-submit-key',
    );
  });

  it('routes guest and staff Bill reads through scoped principals', async () => {
    await controller.currentGuest({ guestPrincipal } as unknown as GuestRequest);
    await controller.currentStaff(guestPrincipal.tableSessionId, {
      staffPrincipal,
    } as unknown as StaffRequest);
    expect(currentForGuest).toHaveBeenCalledWith(guestPrincipal);
    expect(currentForStaff).toHaveBeenCalledWith(staffPrincipal, guestPrincipal.tableSessionId);
  });
});
