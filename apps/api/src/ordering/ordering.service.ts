import { ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { IdempotencyActorType } from '../generated/prisma/enums.js';
import type { GuestPrincipal } from '../guest-session/guest-session.types.js';
import type { StaffPrincipal } from '../staff-auth/staff-auth.types.js';
import type { ConsolidatedSessionView, SubmitOrderBody } from './ordering.contract.js';
import { OrderPersistence, type PersistedOrder } from './order-persistence.js';

const STAFF_IDEMPOTENCY_MAX_MS = 8 * 60 * 60 * 1_000;

function denied(): ForbiddenException {
  return new ForbiddenException({
    code: 'ORDER_SCOPE_DENIED',
    message: 'Order scope is invalid.',
    details: {},
  });
}

@Injectable()
export class OrderingService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(OrderPersistence) private readonly persistence: OrderPersistence,
  ) {}

  submitGuest(
    principal: GuestPrincipal,
    body: SubmitOrderBody,
    idempotencyKey: string,
  ): Promise<PersistedOrder> {
    if (principal.accessLevel !== 'ORDER_ENABLED' || !principal.tableSessionId) throw denied();
    return this.persistence.persist({
      restaurantId: principal.restaurantId,
      locationId: principal.locationId,
      tableSessionId: principal.tableSessionId,
      actor: { type: IdempotencyActorType.GUEST_SESSION, id: principal.sessionId },
      idempotencyKey,
      idempotencyExpiresAt: principal.absoluteExpiresAt,
      items: body.items,
    });
  }

  submitStaff(
    principal: StaffPrincipal,
    tableSessionId: string,
    body: SubmitOrderBody,
    idempotencyKey: string,
  ): Promise<PersistedOrder> {
    return this.persistence.persist({
      restaurantId: principal.restaurantId,
      locationId: principal.locationId,
      tableSessionId,
      actor: {
        type: IdempotencyActorType.STAFF_MEMBERSHIP,
        id: principal.membershipId,
        staffSessionId: principal.sessionId,
      },
      idempotencyKey,
      idempotencyExpiresAt: new Date(Date.now() + STAFF_IDEMPOTENCY_MAX_MS),
      items: body.items,
    });
  }

  currentForGuest(principal: GuestPrincipal): Promise<ConsolidatedSessionView> {
    if (principal.accessLevel !== 'ORDER_ENABLED' || !principal.tableSessionId) throw denied();
    return this.readSession(principal.tableSessionId, principal.restaurantId, principal.locationId);
  }

  currentForStaff(
    principal: StaffPrincipal,
    tableSessionId: string,
  ): Promise<ConsolidatedSessionView> {
    return this.readSession(tableSessionId, principal.restaurantId, principal.locationId);
  }

  private async readSession(
    tableSessionId: string,
    restaurantId: string,
    locationId: string,
  ): Promise<ConsolidatedSessionView> {
    const session = await this.prisma.tableSession.findFirst({
      where: { id: tableSessionId, restaurantId, locationId, status: 'ACTIVE' },
      select: {
        id: true,
        status: true,
        activatedAt: true,
        version: true,
        table: { select: { publicId: true, code: true } },
        orders: {
          orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            orderNumber: true,
            source: true,
            status: true,
            submittedAt: true,
            items: {
              orderBy: { id: 'asc' },
              select: {
                id: true,
                nameSnapshot: true,
                quantity: true,
                unitPriceAmount: true,
                status: true,
                stationSnapshot: true,
                note: true,
                version: true,
                billLine: { select: { lineAmount: true } },
                cancellationRequests: {
                  orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                  take: 1,
                  select: {
                    id: true,
                    status: true,
                    version: true,
                    requestReason: true,
                    decisionReason: true,
                    createdAt: true,
                    decidedAt: true,
                  },
                },
              },
            },
          },
        },
        bill: {
          select: {
            id: true,
            status: true,
            subtotalAmount: true,
            adjustmentAmount: true,
            totalAmount: true,
            paidAmount: true,
            balanceAmount: true,
            version: true,
            lines: {
              orderBy: { id: 'asc' },
              select: {
                id: true,
                orderItemId: true,
                descriptionSnapshot: true,
                quantity: true,
                unitAmount: true,
                lineAmount: true,
              },
            },
            adjustments: {
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
              select: {
                id: true,
                orderItemId: true,
                kind: true,
                amount: true,
                reason: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });
    if (!session?.bill) {
      throw new ConflictException({
        code: 'TABLE_SESSION_NOT_ORDERABLE',
        message: 'Table session is not orderable.',
        details: {},
      });
    }
    return {
      session: {
        id: session.id,
        status: 'ACTIVE',
        activatedAt: session.activatedAt.toISOString(),
        version: session.version,
        table: session.table,
      },
      orders: session.orders.map((order) => ({
        ...order,
        status: 'SUBMITTED',
        submittedAt: order.submittedAt.toISOString(),
        items: order.items.map(
          ({ billLine, cancellationRequests = [], unitPriceAmount, ...item }) => ({
            ...item,
            unitPriceAmount: unitPriceAmount.toString(),
            lineAmount: billLine?.lineAmount.toString() ?? '0',
            cancellationRequest: cancellationRequests[0]
              ? {
                  ...cancellationRequests[0],
                  createdAt: cancellationRequests[0].createdAt.toISOString(),
                  decidedAt: cancellationRequests[0].decidedAt?.toISOString() ?? null,
                }
              : null,
          }),
        ),
      })),
      bill: {
        ...session.bill,
        subtotalAmount: session.bill.subtotalAmount.toString(),
        adjustmentAmount: session.bill.adjustmentAmount.toString(),
        totalAmount: session.bill.totalAmount.toString(),
        paidAmount: session.bill.paidAmount.toString(),
        balanceAmount: session.bill.balanceAmount.toString(),
        lines: session.bill.lines.map((line) => ({
          ...line,
          unitAmount: line.unitAmount.toString(),
          lineAmount: line.lineAmount.toString(),
        })),
        adjustments: (session.bill.adjustments ?? []).map((adjustment) => ({
          ...adjustment,
          amount: adjustment.amount.toString(),
          createdAt: adjustment.createdAt.toISOString(),
        })),
      },
    };
  }
}
