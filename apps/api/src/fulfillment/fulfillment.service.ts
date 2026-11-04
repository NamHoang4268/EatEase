import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { StaffPrincipal } from '../staff-auth/staff-auth.types.js';
import { encodeQueueCursor, type FulfillmentQuery } from './fulfillment-query.js';

@Injectable()
export class FulfillmentService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(principal: StaffPrincipal, query: FulfillmentQuery) {
    const cursorTime = query.cursor ? new Date(query.cursor.submittedAt) : undefined;
    const rows = await this.prisma.orderItem.findMany({
      where: {
        restaurantId: principal.restaurantId,
        locationId: principal.locationId,
        status: query.status,
        ...(query.station ? { stationSnapshot: query.station } : {}),
        order: { status: 'SUBMITTED' },
        ...(query.cursor && cursorTime
          ? {
              OR: [
                { order: { submittedAt: { gt: cursorTime } } },
                { order: { submittedAt: cursorTime }, id: { gt: query.cursor.itemId } },
              ],
            }
          : {}),
      },
      orderBy: [{ order: { submittedAt: 'asc' } }, { id: 'asc' }],
      take: query.limit + 1,
      select: {
        id: true,
        nameSnapshot: true,
        quantity: true,
        note: true,
        stationSnapshot: true,
        status: true,
        version: true,
        order: {
          select: {
            id: true,
            orderNumber: true,
            source: true,
            submittedAt: true,
            tableSession: {
              select: { id: true, table: { select: { code: true } } },
            },
          },
        },
      },
    });
    const items = rows.slice(0, query.limit).map(({ order, ...item }) => ({
      ...item,
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        source: order.source,
        submittedAt: order.submittedAt.toISOString(),
      },
      tableSessionId: order.tableSession.id,
      table: order.tableSession.table,
    }));
    const last = items.at(-1);
    return {
      items,
      page: {
        limit: query.limit,
        nextCursor:
          rows.length > query.limit && last
            ? encodeQueueCursor({ submittedAt: last.order.submittedAt, itemId: last.id })
            : null,
      },
    };
  }
}
