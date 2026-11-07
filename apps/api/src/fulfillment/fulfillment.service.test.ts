import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../database/prisma.service.js';
import type { StaffPrincipal } from '../staff-auth/staff-auth.types.js';
import { FulfillmentService } from './fulfillment.service.js';

describe('FulfillmentService', () => {
  it.each(['NEW', 'PREPARING', 'READY', 'SERVED'] as const)(
    'scopes a bounded %s query and returns operational snapshots with a stable next cursor',
    async (status) => {
      const findMany = vi.fn().mockResolvedValue(
        [1, 2].map((id) => ({
          id: `a1000000-0000-4000-8000-00000000000${id}`,
          nameSnapshot: 'Historical dish',
          quantity: 2,
          note: 'Không hành',
          modifiersSnapshot: [],
          stationSnapshot: 'KITCHEN',
          status,
          version: 0,
          order: {
            id: 'order',
            orderNumber: 'order-reference',
            source: 'QR_GUEST',
            submittedAt: new Date('2026-11-05T00:00:00.000Z'),
            tableSession: { id: 'session', table: { code: 'A01' } },
          },
        })),
      );
      const service = new FulfillmentService({
        orderItem: { findMany },
      } as unknown as PrismaService);
      const principal = {
        restaurantId: 'server-restaurant',
        locationId: 'server-location',
      } as StaffPrincipal;
      const result = await service.list(principal, { status, station: 'KITCHEN', limit: 1 });
      expect(findMany).toHaveBeenCalledTimes(1);
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            restaurantId: principal.restaurantId,
            locationId: principal.locationId,
            status,
            stationSnapshot: 'KITCHEN',
            order: { status: 'SUBMITTED' },
          },
          take: 2,
          orderBy: [{ order: { submittedAt: 'asc' } }, { id: 'asc' }],
        }),
      );
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        nameSnapshot: 'Historical dish',
        quantity: 2,
        note: 'Không hành',
        table: { code: 'A01' },
      });
      expect(result.page.nextCursor).toBeTypeOf('string');
      const select = findMany.mock.calls[0]?.[0] as { select: Record<string, unknown> };
      expect(select.select).not.toHaveProperty('unitPriceAmount');
      expect(select.select).not.toHaveProperty('billLine');
    },
  );
});
