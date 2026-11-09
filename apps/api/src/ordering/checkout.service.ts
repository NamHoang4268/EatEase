import { createHash } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { GuestPrincipal } from '../guest-session/guest-session.types.js';
import type { StaffPrincipal } from '../staff-auth/staff-auth.types.js';
import type { CheckoutBody, CheckoutResult } from './checkout.contract.js';

type Actor =
  { kind: 'guest'; principal: GuestPrincipal } | { kind: 'staff'; principal: StaffPrincipal };
type Input = CheckoutBody & { tableSessionId: string; idempotencyKey: string };
const denied = () => new ForbiddenException({ code: 'CHECKOUT_SCOPE_DENIED' });
const conflict = (code: string) => new ConflictException({ code });

@Injectable()
export class CheckoutService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  checkoutGuest(principal: GuestPrincipal, input: Input): Promise<CheckoutResult> {
    if (
      principal.accessLevel !== 'ORDER_ENABLED' ||
      principal.tableSessionId !== input.tableSessionId
    )
      throw denied();
    return this.execute({ kind: 'guest', principal }, input, false);
  }

  checkoutStaff(principal: StaffPrincipal, input: Input): Promise<CheckoutResult> {
    return this.execute({ kind: 'staff', principal }, input, false);
  }

  resume(principal: StaffPrincipal, input: Input): Promise<CheckoutResult> {
    return this.execute({ kind: 'staff', principal }, input, true);
  }

  private async execute(actor: Actor, input: Input, resume: boolean): Promise<CheckoutResult> {
    const { restaurantId, locationId } = actor.principal;
    const scope = { restaurantId, locationId };
    const key = {
      actorType:
        actor.kind === 'guest' ? ('GUEST_SESSION' as const) : ('STAFF_MEMBERSHIP' as const),
      actorId: actor.kind === 'guest' ? actor.principal.sessionId : actor.principal.membershipId,
      operation: resume ? 'RESUME_ORDERING' : 'REQUEST_CHECKOUT',
      idempotencyKey: input.idempotencyKey,
    };
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          ...scope,
          tableSessionId: input.tableSessionId,
          expectedSessionVersion: input.expectedSessionVersion,
          expectedBillVersion: input.expectedBillVersion,
        }),
      )
      .digest('hex');
    const execute = () =>
      this.prisma.$transaction(async (tx) => {
        const sessions = await tx.$queryRaw<
          Array<{ id: string; status: string; version: number; activatedAt: Date }>
        >`
        SELECT "id", "status", "version", "activated_at" AS "activatedAt" FROM "table_session"
        WHERE "id" = ${input.tableSessionId}::uuid AND "restaurant_id" = ${restaurantId}::uuid
          AND "location_id" = ${locationId}::uuid FOR UPDATE`;
        const session = sessions[0];
        if (!session) throw denied();
        const bills = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "bill" WHERE "table_session_id" = ${session.id}::uuid FOR UPDATE`;
        if (!bills[0]) throw denied();
        const expiresAt = await this.authorize(tx, actor, session.id);
        const replay = await tx.idempotencyRecord.findUnique({
          where: { actorType_actorId_operation_idempotencyKey: key },
        });
        if (replay) {
          if (
            replay.restaurantId !== restaurantId ||
            replay.resourceId !== session.id ||
            replay.requestHash !== requestHash
          )
            throw conflict('IDEMPOTENCY_KEY_REUSED');
          return replay.responseBody as unknown as CheckoutResult;
        }
        const bill = await tx.bill.findUniqueOrThrow({ where: { id: bills[0].id } });
        if (
          session.version !== input.expectedSessionVersion ||
          bill.version !== input.expectedBillVersion
        )
          throw conflict('CHECKOUT_VERSION_CONFLICT');
        if (
          session.status !== (resume ? 'CHECKOUT_LOCKED' : 'ACTIVE') ||
          bill.status !== (resume ? 'PAYMENT_PENDING' : 'OPEN')
        )
          throw conflict('CHECKOUT_STATE_CONFLICT');
        // M4 payment/settlement persistence must extend this guard in the same release that introduces it.
        // No payment records exist in M4.1; any recorded paid amount already fails closed.
        if (bill.paidAmount !== 0n) throw conflict('CHECKOUT_PAYMENT_RECORDED');
        if (!resume) {
          const orders = await tx.order.count({ where: { tableSessionId: session.id, ...scope } });
          const items = await tx.orderItem.findMany({
            where: { billId: bill.id, ...scope },
            select: { id: true, status: true, billLine: { select: { id: true } } },
          });
          if (!orders || !items.length || items.some((item) => !item.billLine))
            throw conflict('CHECKOUT_EMPTY_SESSION');
          if (items.some((item) => !['SERVED', 'CANCELLED', 'REJECTED'].includes(item.status)))
            throw conflict('CHECKOUT_ITEMS_NOT_TERMINAL');
          if (
            await tx.cancellationRequest.count({
              where: {
                tableSessionId: session.id,
                status: { in: ['PENDING_WAITER', 'PENDING_KITCHEN'] },
              },
            })
          )
            throw conflict('CHECKOUT_CANCELLATION_PENDING');
        }
        const now = new Date(Math.max(Date.now(), session.activatedAt.getTime()));
        if (expiresAt <= now)
          throw new UnauthorizedException({
            code: actor.kind === 'guest' ? 'GUEST_SESSION_INVALID' : 'STAFF_SESSION_INVALID',
          });
        const updatedSession = await tx.tableSession.update({
          where: { id: session.id },
          data: {
            status: resume ? 'ACTIVE' : 'CHECKOUT_LOCKED',
            checkoutLockedAt: resume ? null : now,
            version: { increment: 1 },
          },
        });
        const updatedBill = await tx.bill.update({
          where: { id: bill.id },
          data: { status: resume ? 'OPEN' : 'PAYMENT_PENDING', version: { increment: 1 } },
        });
        const result: CheckoutResult = {
          session: {
            id: session.id,
            status: resume ? 'ACTIVE' : 'CHECKOUT_LOCKED',
            version: updatedSession.version,
            checkoutLockedAt: updatedSession.checkoutLockedAt?.toISOString() ?? null,
          },
          bill: {
            id: bill.id,
            status: resume ? 'OPEN' : 'PAYMENT_PENDING',
            version: updatedBill.version,
          },
        };
        await tx.auditLog.create({
          data: {
            ...scope,
            actorType: key.actorType,
            actorId: key.actorId,
            action: resume ? 'ORDERING_RESUMED' : 'CHECKOUT_REQUESTED',
            resourceType: 'TableSession',
            resourceId: session.id,
            createdAt: now,
            metadata: {
              billId: bill.id,
              sessionStatusBefore: session.status,
              sessionStatusAfter: result.session.status,
              sessionVersionBefore: session.version,
              sessionVersionAfter: result.session.version,
              billStatusBefore: bill.status,
              billStatusAfter: result.bill.status,
              billVersionBefore: bill.version,
              billVersionAfter: result.bill.version,
            },
          },
        });
        await tx.outboxEvent.createMany({
          data: [
            {
              ...scope,
              aggregateType: 'TableSession',
              aggregateId: session.id,
              eventType: 'table.session.updated',
              occurredAt: now,
              payload: {
                id: session.id,
                tableId: updatedSession.tableId,
                status: result.session.status,
                version: result.session.version,
                occurredAt: now.toISOString(),
              },
            },
            {
              ...scope,
              aggregateType: 'Bill',
              aggregateId: bill.id,
              eventType: 'bill.updated',
              occurredAt: now,
              payload: {
                id: bill.id,
                tableSessionId: session.id,
                status: result.bill.status,
                version: result.bill.version,
                occurredAt: now.toISOString(),
              },
            },
          ],
        });
        await tx.idempotencyRecord.create({
          data: {
            ...key,
            restaurantId,
            requestHash,
            resourceId: session.id,
            responseStatus: 200,
            responseBody: result,
            expiresAt,
          },
        });
        return result;
      });
    try {
      return await execute();
    } catch (error) {
      if (typeof error !== 'object' || !error || !('code' in error) || error.code !== 'P2002')
        throw error;
      if (
        !(await this.prisma.idempotencyRecord.findUnique({
          where: { actorType_actorId_operation_idempotencyKey: key },
        }))
      )
        throw error;
      return execute();
    }
  }

  private async authorize(
    tx: Prisma.TransactionClient,
    actor: Actor,
    tableSessionId: string,
  ): Promise<Date> {
    const { restaurantId, locationId } = actor.principal;
    if (actor.kind === 'guest') {
      const rows = await tx.$queryRaw<Array<{ expiresAt: Date }>>`
        SELECT LEAST(gs."idle_expires_at", gs."absolute_expires_at") AS "expiresAt" FROM "guest_session" gs
        JOIN "location" l ON l."id" = gs."location_id" AND l."restaurant_id" = gs."restaurant_id"
        JOIN "restaurant" r ON r."id" = gs."restaurant_id"
        WHERE gs."id" = ${actor.principal.sessionId}::uuid AND gs."restaurant_id" = ${restaurantId}::uuid
          AND gs."location_id" = ${locationId}::uuid AND gs."table_session_id" = ${tableSessionId}::uuid
          AND gs."table_id" = ${actor.principal.tableId}::uuid AND gs."access_level" = 'ORDER_ENABLED'
          AND gs."revoked_at" IS NULL AND gs."idle_expires_at" > clock_timestamp() AND gs."absolute_expires_at" > clock_timestamp()
          AND l."is_active" = true AND r."status" = 'ACTIVE' FOR SHARE OF gs, l, r`;
      if (!rows[0]) throw new UnauthorizedException({ code: 'GUEST_SESSION_INVALID' });
      return rows[0].expiresAt;
    }
    const p = actor.principal;
    const rows = await tx.$queryRaw<Array<{ expiresAt: Date }>>`
      SELECT ss."expires_at" AS "expiresAt" FROM "staff_session" ss
      JOIN "staff_membership" sm ON sm."id" = ss."membership_id" AND sm."staff_user_id" = ss."staff_user_id"
      JOIN "staff_user" su ON su."id" = ss."staff_user_id"
      JOIN "location" l ON l."id" = sm."location_id" AND l."restaurant_id" = sm."restaurant_id"
      JOIN "restaurant" r ON r."id" = sm."restaurant_id"
      WHERE ss."id" = ${p.sessionId}::uuid AND ss."staff_user_id" = ${p.staffUserId}::uuid
        AND sm."id" = ${p.membershipId}::uuid AND sm."restaurant_id" = ${restaurantId}::uuid AND sm."location_id" = ${locationId}::uuid
        AND ss."revoked_at" IS NULL AND ss."expires_at" > clock_timestamp()
        AND sm."status" = 'ACTIVE' AND su."status" = 'ACTIVE' AND l."is_active" = true AND r."status" = 'ACTIVE'
      FOR SHARE OF ss, sm, su, l, r`;
    if (!rows[0]) throw new UnauthorizedException({ code: 'STAFF_SESSION_INVALID' });
    const permissions = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT p."id" FROM "membership_role" mr JOIN "role_permission" rp ON rp."role_id" = mr."role_id"
      JOIN "permission" p ON p."id" = rp."permission_id"
      WHERE mr."membership_id" = ${p.membershipId}::uuid AND mr."restaurant_id" = ${restaurantId}::uuid
        AND p."code" = 'bill.checkout' FOR SHARE OF mr, rp, p`;
    if (!permissions[0]) throw denied();
    return rows[0].expiresAt;
  }
}
