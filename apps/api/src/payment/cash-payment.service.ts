import { createHash } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { StaffPrincipal } from '../staff-auth/staff-auth.types.js';
import type { CashPaymentInput, CashPaymentResult } from './cash-payment.contract.js';

const denied = () => new ForbiddenException({ code: 'CASH_PAYMENT_SCOPE_DENIED' });
const conflict = (code: string) => new ConflictException({ code });

@Injectable()
export class CashPaymentService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async record(principal: StaffPrincipal, input: CashPaymentInput): Promise<CashPaymentResult> {
    const { restaurantId, locationId } = principal;
    const scope = { restaurantId, locationId };
    const key = {
      actorType: 'STAFF_MEMBERSHIP' as const,
      actorId: principal.membershipId,
      operation: 'RECORD_CASH_PAYMENT',
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
        // Same parent ordering as SubmitOrder, checkout/resume and financial corrections.
        const sessions = await tx.$queryRaw<
          Array<{
            id: string;
            tableId: string;
            status: string;
            version: number;
            activatedAt: Date;
            checkoutLockedAt: Date | null;
          }>
        >`
        SELECT "id", "table_id" AS "tableId", "status", "version",
          "activated_at" AS "activatedAt", "checkout_locked_at" AS "checkoutLockedAt"
        FROM "table_session" WHERE "id" = ${input.tableSessionId}::uuid
          AND "restaurant_id" = ${restaurantId}::uuid AND "location_id" = ${locationId}::uuid
        FOR UPDATE`;
        const session = sessions[0];
        if (!session) throw denied();
        const bills = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "bill" WHERE "table_session_id" = ${session.id}::uuid
          AND "restaurant_id" = ${restaurantId}::uuid AND "location_id" = ${locationId}::uuid
        FOR UPDATE`;
        if (!bills[0]) throw denied();
        const expiresAt = await this.authorize(tx, principal);
        if (expiresAt.getTime() <= Date.now())
          throw new UnauthorizedException({ code: 'STAFF_SESSION_INVALID' });
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
          return replay.responseBody as unknown as CashPaymentResult;
        }
        const bill = await tx.bill.findUniqueOrThrow({ where: { id: bills[0].id } });
        if (
          session.version !== input.expectedSessionVersion ||
          bill.version !== input.expectedBillVersion
        )
          throw conflict('CASH_PAYMENT_VERSION_CONFLICT');
        if (session.status !== 'CHECKOUT_LOCKED' || bill.status !== 'PAYMENT_PENDING')
          throw conflict('CASH_PAYMENT_STATE_CONFLICT');
        const table = await tx.restaurantTable.findUnique({ where: { id: session.tableId } });
        // Reject pre-existing/partial financial records instead of accepting a second payment.
        if (
          table?.physicalStatus !== 'OCCUPIED' ||
          bill.paidAmount !== 0n ||
          bill.balanceAmount < 0n ||
          bill.totalAmount < 0n ||
          bill.totalAmount !== bill.subtotalAmount + bill.adjustmentAmount ||
          bill.balanceAmount !== bill.totalAmount - bill.paidAmount ||
          (await tx.payment.findFirst({
            where: { billId: bill.id, status: 'SUCCEEDED' },
            select: { id: true },
          })) ||
          (await tx.settlement.findUnique({ where: { billId: bill.id }, select: { id: true } }))
        )
          throw conflict('CASH_PAYMENT_STATE_CONFLICT');

        const now = new Date(
          Math.max(
            Date.now(),
            session.activatedAt.getTime(),
            session.checkoutLockedAt?.getTime() ?? 0,
          ),
        );
        if (expiresAt <= now) throw new UnauthorizedException({ code: 'STAFF_SESSION_INVALID' });
        const payment =
          bill.balanceAmount > 0n
            ? await tx.payment.create({
                data: {
                  ...scope,
                  billId: bill.id,
                  method: 'CASH',
                  status: 'SUCCEEDED',
                  amount: bill.balanceAmount,
                  recordedByMembershipId: principal.membershipId,
                  recordedAt: now,
                },
              })
            : null;
        const settlement = await tx.settlement.create({
          data: {
            ...scope,
            billId: bill.id,
            settledAmount: bill.totalAmount,
            createdByMembershipId: principal.membershipId,
            settledAt: now,
          },
        });
        const updatedBill = await tx.bill.update({
          where: { id: bill.id },
          data: {
            status: 'SETTLED',
            paidAmount: bill.totalAmount,
            balanceAmount: 0n,
            version: { increment: 1 },
          },
        });
        const result: CashPaymentResult = {
          session: { id: session.id, status: 'CHECKOUT_LOCKED', version: session.version },
          bill: {
            id: bill.id,
            status: 'SETTLED',
            version: updatedBill.version,
            totalAmount: updatedBill.totalAmount.toString(),
            paidAmount: updatedBill.paidAmount.toString(),
            balanceAmount: updatedBill.balanceAmount.toString(),
          },
          payment: payment
            ? {
                id: payment.id,
                method: 'CASH',
                status: 'SUCCEEDED',
                amount: payment.amount.toString(),
                recordedAt: payment.recordedAt.toISOString(),
              }
            : null,
          settlement: {
            id: settlement.id,
            settledAmount: settlement.settledAmount.toString(),
            settledAt: settlement.settledAt.toISOString(),
          },
        };
        await tx.auditLog.create({
          data: {
            ...scope,
            actorType: 'STAFF_MEMBERSHIP',
            actorId: principal.membershipId,
            action: 'CASH_PAYMENT_SETTLED',
            resourceType: 'Bill',
            resourceId: bill.id,
            createdAt: now,
            metadata: {
              tableSessionId: session.id,
              paymentId: payment?.id ?? null,
              settlementId: settlement.id,
              amount: bill.balanceAmount.toString(),
              billStatusBefore: bill.status,
              billStatusAfter: 'SETTLED',
              billVersionBefore: bill.version,
              billVersionAfter: updatedBill.version,
            },
          },
        });
        await tx.outboxEvent.create({
          data: {
            ...scope,
            aggregateType: 'Bill',
            aggregateId: bill.id,
            eventType: 'bill.updated',
            occurredAt: now,
            payload: {
              id: bill.id,
              tableSessionId: session.id,
              status: 'SETTLED',
              version: updatedBill.version,
              occurredAt: now.toISOString(),
            },
          },
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
      // A shared actor/key can race across different resources. Roll back before replaying.
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

  private async authorize(tx: Prisma.TransactionClient, principal: StaffPrincipal): Promise<Date> {
    const p = principal;
    const sessions = await tx.$queryRaw<Array<{ expiresAt: Date }>>`
      SELECT ss."expires_at" AS "expiresAt" FROM "staff_session" ss
      JOIN "staff_membership" sm ON sm."id" = ss."membership_id" AND sm."staff_user_id" = ss."staff_user_id"
      JOIN "staff_user" su ON su."id" = ss."staff_user_id"
      JOIN "location" l ON l."id" = sm."location_id" AND l."restaurant_id" = sm."restaurant_id"
      JOIN "restaurant" r ON r."id" = sm."restaurant_id"
      WHERE ss."id" = ${p.sessionId}::uuid AND ss."staff_user_id" = ${p.staffUserId}::uuid
        AND sm."id" = ${p.membershipId}::uuid AND sm."restaurant_id" = ${p.restaurantId}::uuid
        AND sm."location_id" = ${p.locationId}::uuid AND ss."revoked_at" IS NULL
        AND ss."expires_at" > clock_timestamp() AND sm."status" = 'ACTIVE' AND su."status" = 'ACTIVE'
        AND l."is_active" = true AND r."status" = 'ACTIVE'
      FOR SHARE OF ss, sm, su, l, r`;
    if (!sessions[0]) throw new UnauthorizedException({ code: 'STAFF_SESSION_INVALID' });
    const permissions = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT p."id" FROM "membership_role" mr
      JOIN "role_permission" rp ON rp."role_id" = mr."role_id"
      JOIN "permission" p ON p."id" = rp."permission_id"
      WHERE mr."membership_id" = ${principal.membershipId}::uuid
        AND mr."restaurant_id" = ${principal.restaurantId}::uuid AND p."code" = 'payment.cash_record'
      FOR SHARE OF mr, rp, p`;
    if (!permissions[0]) throw denied();
    return sessions[0].expiresAt;
  }
}
