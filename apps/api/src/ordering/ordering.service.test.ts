import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../database/prisma.service.js';
import { IdempotencyActorType } from '../generated/prisma/enums.js';
import type { GuestPrincipal } from '../guest-session/guest-session.types.js';
import type { StaffPrincipal } from '../staff-auth/staff-auth.types.js';
import type { OrderPersistence } from './order-persistence.js';
import { OrderingService } from './ordering.service.js';

const restaurantId = 'a1000000-0000-4000-8000-000000000001';
const locationId = 'a2000000-0000-4000-8000-000000000001';
const tableSessionId = 'a3000000-0000-4000-8000-000000000001';
const items = [
  {
    menuItemId: 'a4000000-0000-4000-8000-000000000001',
    quantity: 1,
    modifierSelections: [],
    note: null,
  },
];
const guest = {
  sessionId: 'a5000000-0000-4000-8000-000000000001',
  restaurantId,
  locationId,
  tableId: 'a6000000-0000-4000-8000-000000000001',
  tablePublicId: 'a7000000-0000-4000-8000-000000000001',
  tableSessionId,
  accessLevel: 'ORDER_ENABLED',
  idleExpiresAt: new Date(Date.now() + 60_000),
  absoluteExpiresAt: new Date(Date.now() + 120_000),
  csrfTokenHash: 'a'.repeat(64),
} satisfies GuestPrincipal;
const staff = {
  sessionId: 'a8000000-0000-4000-8000-000000000001',
  staffUserId: 'a9000000-0000-4000-8000-000000000001',
  membershipId: 'aa000000-0000-4000-8000-000000000001',
  restaurantId,
  locationId,
  email: 'waiter@example.test',
  name: 'Waiter',
  permissions: ['order.create_for_table'],
  csrfTokenHash: 'b'.repeat(64),
} satisfies StaffPrincipal;

describe('OrderingService', () => {
  const persist = vi.fn().mockResolvedValue({ order: { id: 'order' } });
  const findFirst = vi.fn();
  const service = new OrderingService(
    { tableSession: { findFirst } } as unknown as PrismaService,
    { persist } as unknown as OrderPersistence,
  );

  it('maps Guest and Waiter submissions to the same persistence boundary with server scope', async () => {
    await service.submitGuest(guest, { items }, 'guest-key');
    expect(persist).toHaveBeenLastCalledWith(
      expect.objectContaining({
        restaurantId,
        locationId,
        tableSessionId,
        actor: { type: IdempotencyActorType.GUEST_SESSION, id: guest.sessionId },
      }),
    );

    await service.submitStaff(staff, tableSessionId, { items }, 'staff-key');
    expect(persist).toHaveBeenLastCalledWith(
      expect.objectContaining({
        restaurantId,
        locationId,
        tableSessionId,
        actor: {
          type: IdempotencyActorType.STAFF_MEMBERSHIP,
          id: staff.membershipId,
          staffSessionId: staff.sessionId,
        },
      }),
    );
  });

  it('denies browse-only or unbound guests without invoking persistence', () => {
    persist.mockClear();
    expect(() =>
      service.submitGuest(
        { ...guest, accessLevel: 'BROWSE_ONLY', tableSessionId: null },
        { items },
        'guest-key',
      ),
    ).toThrow(ForbiddenException);
    expect(persist).not.toHaveBeenCalled();
  });

  it('serializes current authoritative Bill and historical snapshots as decimal strings', async () => {
    findFirst.mockResolvedValueOnce({
      id: tableSessionId,
      status: 'ACTIVE',
      activatedAt: new Date('2026-11-05T00:00:00.000Z'),
      version: 2,
      table: { publicId: guest.tablePublicId, code: 'A01' },
      orders: [
        {
          id: 'ab000000-0000-4000-8000-000000000001',
          orderNumber: 'ORDER-1',
          source: 'QR_GUEST',
          status: 'SUBMITTED',
          submittedAt: new Date('2026-11-05T00:01:00.000Z'),
          items: [
            {
              id: 'ac000000-0000-4000-8000-000000000001',
              nameSnapshot: 'Phở',
              quantity: 2,
              unitPriceAmount: 50_000n,
              status: 'NEW',
              stationSnapshot: 'KITCHEN',
              note: null,
              version: 0,
              billLine: { lineAmount: 100_000n },
            },
          ],
        },
      ],
      bill: {
        id: 'ad000000-0000-4000-8000-000000000001',
        status: 'OPEN',
        subtotalAmount: 100_000n,
        adjustmentAmount: 0n,
        totalAmount: 100_000n,
        paidAmount: 0n,
        balanceAmount: 100_000n,
        version: 1,
        lines: [
          {
            id: 'ae000000-0000-4000-8000-000000000001',
            orderItemId: 'ac000000-0000-4000-8000-000000000001',
            descriptionSnapshot: 'Phở',
            quantity: 2,
            unitAmount: 50_000n,
            lineAmount: 100_000n,
          },
        ],
      },
    });

    const result = await service.currentForGuest(guest);
    expect(result.bill.totalAmount).toBe('100000');
    expect(result.bill.lines[0]).toMatchObject({ unitAmount: '50000', lineAmount: '100000' });
    expect(result.orders[0]?.items[0]).toMatchObject({
      nameSnapshot: 'Phở',
      unitPriceAmount: '50000',
      lineAmount: '100000',
    });
  });
});
