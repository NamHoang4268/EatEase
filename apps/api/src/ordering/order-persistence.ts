import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { IdempotencyActorType, OrderSource } from '../generated/prisma/enums.js';
import { addVnd, checkedVnd, lineAmount } from './order-money.js';

const OPERATION = 'SUBMIT_ORDER';
const selectionSchema = z
  .object({
    menuItemId: z.uuid(),
    quantity: z.number().int().positive().max(2_147_483_647),
    modifierSelections: z.array(z.never()).default([]),
    note: z
      .string()
      .nullable()
      .optional()
      .transform((value) => value ?? null),
  })
  .strict();
const commandSchema = z
  .object({
    restaurantId: z.uuid(),
    locationId: z.uuid(),
    tableSessionId: z.uuid(),
    actor: z.discriminatedUnion('type', [
      z.object({ type: z.literal(IdempotencyActorType.GUEST_SESSION), id: z.uuid() }).strict(),
      z
        .object({
          type: z.literal(IdempotencyActorType.STAFF_MEMBERSHIP),
          id: z.uuid(),
          staffSessionId: z.uuid(),
        })
        .strict(),
    ]),
    idempotencyKey: z
      .string()
      .min(1)
      .max(128)
      .refine((value) => value.trim().length > 0),
    idempotencyExpiresAt: z.date(),
    items: z.array(selectionSchema).min(1),
  })
  .strict();

export type PersistOrderInput = z.input<typeof commandSchema>;
type Command = z.output<typeof commandSchema>;
export type PersistedOrder = {
  order: {
    id: string;
    orderNumber: string;
    tableSessionId: string;
    billId: string;
    status: 'SUBMITTED';
    submittedAt: string;
    items: Array<{
      id: string;
      menuItemId: string;
      nameSnapshot: string;
      quantity: number;
      unitPriceAmount: string;
      lineAmount: string;
      stationSnapshot: string;
      note: string | null;
    }>;
  };
  bill: {
    id: string;
    subtotalAmount: string;
    adjustmentAmount: string;
    totalAmount: string;
    paidAmount: string;
    balanceAmount: string;
    version: number;
  };
};

function conflict(code: string): ConflictException {
  return new ConflictException({ code, message: 'Order persistence conflict.', details: {} });
}
function denied(): ForbiddenException {
  return new ForbiddenException({
    code: 'ORDER_SCOPE_DENIED',
    message: 'Order scope is invalid.',
    details: {},
  });
}

/** Internal persistence boundary. M2.9 must authenticate the caller, validate Origin/CSRF,
 * and complete transactional staff-session/permission revalidation before wiring endpoints.
 * Scope/actor/expiry must come from the server, never directly from a request body.
 * This provider is intentionally not registered in an HTTP module in M2.8.
 */
@Injectable()
export class OrderPersistence {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async persist(input: PersistOrderInput): Promise<PersistedOrder> {
    const parsed = commandSchema.safeParse(input);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'ORDER_PERSISTENCE_INPUT_INVALID',
        message: 'Invalid order persistence input.',
        details: {},
      });
    }
    const command = parsed.data;
    // Expiry is security metadata, not part of a logical submission fingerprint.
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          restaurantId: command.restaurantId,
          locationId: command.locationId,
          tableSessionId: command.tableSessionId,
          items: command.items,
        }),
      )
      .digest('hex');
    const key = {
      actorType: command.actor.type,
      actorId: command.actor.id,
      operation: OPERATION,
      idempotencyKey: command.idempotencyKey,
    };
    const execute = () =>
      this.prisma.$transaction(async (tx) => {
        const sessions = await tx.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT ts."id", ts."status" FROM "table_session" ts
        WHERE ts."id" = ${command.tableSessionId}::uuid
          AND ts."restaurant_id" = ${command.restaurantId}::uuid
          AND ts."location_id" = ${command.locationId}::uuid FOR UPDATE
      `;
        if (!sessions[0]) throw denied();
        const bills = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "bill" WHERE "table_session_id" = ${command.tableSessionId}::uuid FOR UPDATE
      `;
        if (!bills[0]) throw conflict('ORDER_BILL_MISSING');
        const now = new Date();
        const actorExpiry = await this.assertActor(tx, command, now);
        const replay = await tx.idempotencyRecord.findUnique({
          where: { actorType_actorId_operation_idempotencyKey: key },
        });
        if (replay) {
          if (replay.restaurantId !== command.restaurantId || replay.requestHash !== requestHash) {
            throw conflict('IDEMPOTENCY_KEY_REUSED');
          }
          return replay.responseBody as unknown as PersistedOrder;
        }
        if (sessions[0].status !== 'ACTIVE') throw conflict('TABLE_SESSION_NOT_ORDERABLE');
        const bill = await tx.bill.findUniqueOrThrow({ where: { id: bills[0].id } });
        if (bill.status !== 'OPEN') throw conflict('BILL_NOT_OPEN');
        const expiresAt = new Date(Math.min(command.idempotencyExpiresAt.getTime(), actorExpiry));
        if (expiresAt <= now) throw denied();

        // Lock menu rows deterministically. Concurrent price/availability edits cannot tear snapshots.
        const menuIds = [...new Set(command.items.map((item) => item.menuItemId))].sort();
        const menu = await tx.$queryRaw<
          Array<{
            id: string;
            name: string;
            priceAmount: bigint;
            station: string;
          }>
        >(Prisma.sql`
        SELECT mi."id", mi."name", mi."price_amount" AS "priceAmount", mi."fulfillment_station" AS "station"
        FROM "menu_item" mi
        JOIN "menu_category" mc ON mc."id" = mi."category_id"
        JOIN "location" l ON l."id" = mi."location_id"
        JOIN "restaurant" r ON r."id" = mi."restaurant_id"
        WHERE mi."id" IN (${Prisma.join(menuIds.map((id) => Prisma.sql`${id}::uuid`))})
          AND mi."restaurant_id" = ${command.restaurantId}::uuid
          AND mi."location_id" = ${command.locationId}::uuid
          AND mi."status" = 'ACTIVE' AND mc."status" = 'ACTIVE'
          AND l."is_active" = true AND r."status" = 'ACTIVE'
        ORDER BY mi."id" FOR SHARE OF mi, mc, l, r
      `);
        if (menu.length !== menuIds.length) {
          throw new BadRequestException({
            code: 'ORDER_MENU_ITEM_UNAVAILABLE',
            message: 'A menu item is unavailable.',
            details: {},
          });
        }
        const snapshots = command.items.map((selection) => {
          const item = menu.find((candidate) => candidate.id === selection.menuItemId)!;
          return {
            id: randomUUID(),
            menuItemId: item.id,
            nameSnapshot: item.name,
            quantity: selection.quantity,
            unitPriceAmount: item.priceAmount.toString(),
            lineAmount: lineAmount(item.priceAmount, selection.quantity).toString(),
            stationSnapshot: item.station,
            note: selection.note,
          };
        });
        const subtotal = addVnd([
          bill.subtotalAmount,
          ...snapshots.map((item) => BigInt(item.lineAmount)),
        ]);
        const total = checkedVnd(subtotal + bill.adjustmentAmount);
        const balance = checkedVnd(total - bill.paidAmount);
        const orderId = randomUUID();
        const order = await tx.order.create({
          data: {
            id: orderId,
            orderNumber: orderId,
            itemCount: snapshots.length,
            restaurantId: command.restaurantId,
            locationId: command.locationId,
            tableSessionId: command.tableSessionId,
            billId: bill.id,
            source:
              command.actor.type === IdempotencyActorType.GUEST_SESSION
                ? OrderSource.QR_GUEST
                : OrderSource.STAFF_WAITER,
            createdByGuestSessionId:
              command.actor.type === IdempotencyActorType.GUEST_SESSION ? command.actor.id : null,
            createdByMembershipId:
              command.actor.type === IdempotencyActorType.STAFF_MEMBERSHIP
                ? command.actor.id
                : null,
            submittedAt: now,
          },
        });
        for (const item of snapshots) {
          await tx.orderItem.create({
            data: {
              id: item.id,
              restaurantId: command.restaurantId,
              locationId: command.locationId,
              orderId: order.id,
              billId: bill.id,
              menuItemId: item.menuItemId,
              nameSnapshot: item.nameSnapshot,
              quantity: item.quantity,
              unitPriceAmount: BigInt(item.unitPriceAmount),
              modifiersSnapshot: [],
              note: item.note,
              stationSnapshot: item.stationSnapshot as 'KITCHEN' | 'BAR' | 'DIRECT',
            },
          });
          await tx.billLine.create({
            data: {
              restaurantId: command.restaurantId,
              locationId: command.locationId,
              billId: bill.id,
              orderItemId: item.id,
              descriptionSnapshot: item.nameSnapshot,
              quantity: item.quantity,
              unitAmount: BigInt(item.unitPriceAmount),
              lineAmount: BigInt(item.lineAmount),
            },
          });
        }
        const updatedBill = await tx.bill.update({
          where: { id: bill.id },
          data: {
            subtotalAmount: subtotal,
            totalAmount: total,
            balanceAmount: balance,
            version: { increment: 1 },
          },
        });
        const occurredAt = now.toISOString();
        const events = [
          {
            aggregateType: 'Order',
            aggregateId: order.id,
            eventType: 'order.submitted',
            payload: {
              id: order.id,
              tableSessionId: command.tableSessionId,
              version: 0,
              occurredAt,
            },
          },
          ...snapshots.map((item) => ({
            aggregateType: 'OrderItem',
            aggregateId: item.id,
            eventType: 'fulfillment.item.created',
            payload: {
              id: item.id,
              tableSessionId: command.tableSessionId,
              status: 'NEW',
              version: 0,
              occurredAt,
            },
          })),
          {
            aggregateType: 'Bill',
            aggregateId: bill.id,
            eventType: 'bill.updated',
            payload: {
              id: bill.id,
              tableSessionId: command.tableSessionId,
              version: updatedBill.version,
              occurredAt,
            },
          },
        ];
        await tx.outboxEvent.createMany({
          data: events.map((event) => ({
            ...event,
            restaurantId: command.restaurantId,
            locationId: command.locationId,
            occurredAt: now,
          })),
        });
        const response: PersistedOrder = {
          order: {
            id: order.id,
            orderNumber: order.orderNumber,
            tableSessionId: command.tableSessionId,
            billId: bill.id,
            status: 'SUBMITTED',
            submittedAt: occurredAt,
            items: snapshots,
          },
          bill: {
            id: bill.id,
            subtotalAmount: subtotal.toString(),
            adjustmentAmount: bill.adjustmentAmount.toString(),
            totalAmount: total.toString(),
            paidAmount: bill.paidAmount.toString(),
            balanceAmount: balance.toString(),
            version: updatedBill.version,
          },
        };
        await tx.idempotencyRecord.create({
          data: {
            ...key,
            restaurantId: command.restaurantId,
            requestHash,
            responseStatus: 201,
            responseBody: response,
            resourceId: order.id,
            expiresAt,
          },
        });
        return response;
      });
    try {
      return await execute();
    } catch (error) {
      // Two sessions can race on the same actor/operation/key. Re-enter the same locks and
      // authorization checks to replay the winner; never return an unchecked response here.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const winner = await this.prisma.idempotencyRecord.findUnique({
          where: { actorType_actorId_operation_idempotencyKey: key },
          select: { id: true },
        });
        if (winner) return execute();
      }
      throw error;
    }
  }

  private async assertActor(
    tx: Prisma.TransactionClient,
    command: Command,
    now: Date,
  ): Promise<number> {
    if (command.actor.type === IdempotencyActorType.GUEST_SESSION) {
      const guests = await tx.$queryRaw<Array<{ absoluteExpiresAt: Date }>>`
        SELECT "absolute_expires_at" AS "absoluteExpiresAt" FROM "guest_session"
        WHERE "id" = ${command.actor.id}::uuid AND "restaurant_id" = ${command.restaurantId}::uuid
          AND "location_id" = ${command.locationId}::uuid AND "table_session_id" = ${command.tableSessionId}::uuid
          AND "access_level" = 'ORDER_ENABLED' AND "revoked_at" IS NULL
          AND "idle_expires_at" > ${now} AND "absolute_expires_at" > ${now} FOR SHARE
      `;
      if (!guests[0]) throw denied();
      return guests[0].absoluteExpiresAt.getTime();
    }
    const members = await tx.$queryRaw<Array<{ expiresAt: Date }>>`
      SELECT ss."expires_at" AS "expiresAt"
      FROM "staff_session" ss
      JOIN "staff_membership" sm ON sm."id" = ss."membership_id"
      JOIN "staff_user" su ON su."id" = ss."staff_user_id" AND su."id" = sm."staff_user_id"
      JOIN "membership_role" mr ON mr."membership_id" = sm."id" AND mr."restaurant_id" = sm."restaurant_id"
      JOIN "role_permission" rp ON rp."role_id" = mr."role_id"
      JOIN "permission" p ON p."id" = rp."permission_id"
      WHERE ss."id" = ${command.actor.staffSessionId}::uuid
        AND ss."membership_id" = ${command.actor.id}::uuid
        AND ss."revoked_at" IS NULL AND ss."expires_at" > ${now}
        AND sm."restaurant_id" = ${command.restaurantId}::uuid
        AND sm."location_id" = ${command.locationId}::uuid
        AND sm."status" = 'ACTIVE' AND su."status" = 'ACTIVE'
        AND p."code" = 'order.create_for_table'
      FOR SHARE OF ss, sm, su, mr, rp, p
    `;
    if (!members[0]) throw denied();
    return members[0].expiresAt.getTime();
  }
}
