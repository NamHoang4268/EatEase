import { createHash } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { StaffPrincipal } from '../staff-auth/staff-auth.types.js';

const OPERATION = 'START_PREPARATION';
const denied = () => new ForbiddenException({ code: 'STAFF_AUTHORIZATION_DENIED' });
const conflict = (code: string) => new ConflictException({ code });
type Input = { itemId: string; expectedVersion: number; idempotencyKey: string };
type Result = { item: { id: string; status: 'PREPARING'; version: number; preparingAt: string } };

@Injectable()
export class StartPreparationService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async start(principal: StaffPrincipal, input: Input): Promise<Result> {
    const scope = { restaurantId: principal.restaurantId, locationId: principal.locationId };
    const target = await this.prisma.orderItem.findFirst({
      where: { id: input.itemId, ...scope },
      select: { order: { select: { tableSessionId: true } } },
    });
    if (!target) throw denied();
    const tableSessionId = target.order.tableSessionId;
    const key = {
      actorType: 'STAFF_MEMBERSHIP' as const,
      actorId: principal.membershipId,
      operation: OPERATION,
      idempotencyKey: input.idempotencyKey,
    };
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({ ...scope, itemId: input.itemId, expectedVersion: input.expectedVersion }),
      )
      .digest('hex');
    const execute = () =>
      this.prisma.$transaction(async (tx) => {
        // Match SubmitOrder's parent/actor order; future financial commands must lock Bill before item.
        const sessions = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "table_session" WHERE "id" = ${tableSessionId}::uuid
          AND "restaurant_id" = ${scope.restaurantId}::uuid AND "location_id" = ${scope.locationId}::uuid FOR UPDATE`;
        if (!sessions[0]) throw denied();
        const bills = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "bill" WHERE "table_session_id" = ${tableSessionId}::uuid FOR UPDATE`;
        if (!bills[0]) throw denied();
        const staff = await tx.$queryRaw<Array<{ expiresAt: Date }>>`
        SELECT ss."expires_at" AS "expiresAt" FROM "staff_session" ss
        JOIN "staff_membership" sm ON sm."id" = ss."membership_id" AND sm."staff_user_id" = ss."staff_user_id"
        JOIN "staff_user" su ON su."id" = ss."staff_user_id"
        JOIN "location" l ON l."id" = sm."location_id" AND l."restaurant_id" = sm."restaurant_id"
        JOIN "restaurant" r ON r."id" = sm."restaurant_id"
        WHERE ss."id" = ${principal.sessionId}::uuid AND ss."staff_user_id" = ${principal.staffUserId}::uuid
          AND sm."id" = ${principal.membershipId}::uuid AND sm."restaurant_id" = ${scope.restaurantId}::uuid
          AND sm."location_id" = ${scope.locationId}::uuid AND ss."revoked_at" IS NULL
          AND ss."expires_at" > clock_timestamp() AND sm."status" = 'ACTIVE' AND su."status" = 'ACTIVE'
          AND l."is_active" = true AND r."status" = 'ACTIVE' FOR SHARE OF ss, sm, su, l, r`;
        if (!staff[0]) throw new UnauthorizedException({ code: 'STAFF_SESSION_INVALID' });
        const permissions = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT p."id" FROM "membership_role" mr
        JOIN "role_permission" rp ON rp."role_id" = mr."role_id"
        JOIN "permission" p ON p."id" = rp."permission_id"
        WHERE mr."membership_id" = ${principal.membershipId}::uuid AND mr."restaurant_id" = ${scope.restaurantId}::uuid
          AND p."code" = 'fulfillment.transition' FOR SHARE OF mr, rp, p`;
        if (!permissions[0]) throw denied();
        const items = await tx.$queryRaw<
          Array<{ id: string; status: string; station: string; version: number }>
        >`
        SELECT "id", "status", "station_snapshot" AS "station", "version" FROM "order_item"
        WHERE "id" = ${input.itemId}::uuid AND "restaurant_id" = ${scope.restaurantId}::uuid
          AND "location_id" = ${scope.locationId}::uuid FOR UPDATE`;
        const item = items[0];
        if (!item) throw denied();
        if (staff[0].expiresAt <= new Date())
          throw new UnauthorizedException({ code: 'STAFF_SESSION_INVALID' });
        const replay = await tx.idempotencyRecord.findUnique({
          where: { actorType_actorId_operation_idempotencyKey: key },
        });
        if (replay) {
          if (
            replay.restaurantId !== scope.restaurantId ||
            replay.resourceId !== item.id ||
            replay.requestHash !== requestHash
          )
            throw conflict('IDEMPOTENCY_KEY_REUSED');
          return replay.responseBody as unknown as Result;
        }
        if (item.version !== input.expectedVersion) throw conflict('FULFILLMENT_VERSION_CONFLICT');
        if (item.status !== 'NEW') throw conflict('FULFILLMENT_STATE_CONFLICT');
        if (!['KITCHEN', 'BAR'].includes(item.station))
          throw conflict('FULFILLMENT_STATION_INVALID');
        const now = new Date();
        const updated = await tx.orderItem.update({
          where: { id: item.id, status: 'NEW', version: input.expectedVersion },
          data: { status: 'PREPARING', version: { increment: 1 }, preparingAt: now },
          select: { id: true, version: true },
        });
        const result: Result = {
          item: { ...updated, status: 'PREPARING', preparingAt: now.toISOString() },
        };
        await tx.auditLog.create({
          data: {
            ...scope,
            actorType: 'STAFF_MEMBERSHIP',
            actorId: principal.membershipId,
            action: 'FULFILLMENT_PREPARATION_STARTED',
            resourceType: 'OrderItem',
            resourceId: item.id,
            createdAt: now,
            metadata: {
              tableSessionId,
              statusBefore: 'NEW',
              statusAfter: 'PREPARING',
              versionBefore: item.version,
              versionAfter: updated.version,
            },
          },
        });
        await tx.outboxEvent.create({
          data: {
            ...scope,
            aggregateType: 'OrderItem',
            aggregateId: item.id,
            eventType: 'fulfillment.item.updated',
            occurredAt: now,
            payload: {
              id: item.id,
              tableSessionId,
              status: 'PREPARING',
              version: updated.version,
              occurredAt: now.toISOString(),
            },
          },
        });
        await tx.idempotencyRecord.create({
          data: {
            ...key,
            restaurantId: scope.restaurantId,
            requestHash,
            status: 'COMPLETED',
            responseStatus: 200,
            responseBody: result,
            resourceId: item.id,
            expiresAt: staff[0].expiresAt,
          },
        });
        return result;
      });
    try {
      return await execute();
    } catch (error) {
      // Cross-session same-key races roll back the loser; re-enter locks and current authorization before replay.
      if (
        typeof error !== 'object' ||
        error === null ||
        !('code' in error) ||
        error.code !== 'P2002'
      )
        throw error;
      const winner = await this.prisma.idempotencyRecord.findUnique({
        where: { actorType_actorId_operation_idempotencyKey: key },
      });
      if (!winner) throw error;
      return execute();
    }
  }
}
