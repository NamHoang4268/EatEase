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
import type {
  CancellationDecisionInput,
  CancellationForwardInput,
  DirectRejectionInput,
  GuestCancellationInput,
} from './cancellation.contract.js';

const denied = () => new ForbiddenException({ code: 'CANCELLATION_SCOPE_DENIED' });
const conflict = (code: string) => new ConflictException({ code });

type ItemStatus = 'NEW' | 'PREPARING' | 'READY' | 'SERVED' | 'REJECTED' | 'CANCELLED';
type RequestStatus = 'PENDING_WAITER' | 'PENDING_KITCHEN' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';
type LockedItem = {
  id: string;
  status: ItemStatus;
  station: 'KITCHEN' | 'BAR' | 'DIRECT';
  version: number;
};
type LockedRequest = {
  id: string;
  status: RequestStatus;
  version: number;
  orderItemId: string;
};
type Result = {
  cancellationRequest: {
    id: string;
    orderItemId: string;
    status: RequestStatus;
    version: number;
    decidedAt: string | null;
  };
  item?: { id: string; status: 'CANCELLED'; version: number };
  bill?: {
    id: string;
    adjustmentAmount: string;
    totalAmount: string;
    balanceAmount: string;
    version: number;
  };
  adjustment?: { id: string; kind: 'FULL_CANCELLATION_WAIVER'; amount: string };
};

@Injectable()
export class CancellationService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async requestGuest(principal: GuestPrincipal, input: GuestCancellationInput): Promise<Result> {
    if (principal.accessLevel !== 'ORDER_ENABLED' || !principal.tableSessionId) throw denied();
    const target = await this.prisma.orderItem.findFirst({
      where: {
        id: input.itemId,
        restaurantId: principal.restaurantId,
        locationId: principal.locationId,
        order: { tableSessionId: principal.tableSessionId },
      },
      select: { billId: true, order: { select: { tableSessionId: true } } },
    });
    if (!target) throw denied();
    const key = {
      actorType: 'GUEST_SESSION' as const,
      actorId: principal.sessionId,
      operation: 'REQUEST_ITEM_CANCELLATION',
      idempotencyKey: input.idempotencyKey,
    };
    const requestHash = this.hash({
      itemId: input.itemId,
      expectedVersion: input.expectedVersion,
      reason: input.reason,
    });
    const execute = () =>
      this.prisma.$transaction(async (tx) => {
        await this.lockSessionAndBill(
          tx,
          target.order.tableSessionId,
          target.billId,
          principal.restaurantId,
          principal.locationId,
        );
        await this.revalidateGuest(tx, principal);
        const item = await this.lockItem(
          tx,
          input.itemId,
          principal.restaurantId,
          principal.locationId,
        );
        const replay = await tx.idempotencyRecord.findUnique({
          where: { actorType_actorId_operation_idempotencyKey: key },
        });
        if (replay) {
          if (replay.resourceId !== item.id || replay.requestHash !== requestHash)
            throw conflict('IDEMPOTENCY_KEY_REUSED');
          return replay.responseBody as unknown as Result;
        }
        if (item.version !== input.expectedVersion)
          throw conflict('CANCELLATION_ITEM_VERSION_CONFLICT');
        if (!['NEW', 'PREPARING'].includes(item.status))
          throw conflict('CANCELLATION_ITEM_STATE_CONFLICT');
        const pending = await tx.cancellationRequest.findFirst({
          where: { orderItemId: item.id, status: { in: ['PENDING_WAITER', 'PENDING_KITCHEN'] } },
          select: { id: true },
        });
        if (pending) throw conflict('CANCELLATION_REQUEST_PENDING');
        const now = new Date();
        const created = await tx.cancellationRequest.create({
          data: {
            restaurantId: principal.restaurantId,
            locationId: principal.locationId,
            tableSessionId: principal.tableSessionId!,
            billId: target.billId,
            orderItemId: item.id,
            source: 'GUEST_REQUEST',
            status: 'PENDING_WAITER',
            requesterGuestSessionId: principal.sessionId,
            requestReason: input.reason,
            createdAt: now,
            updatedAt: now,
          },
          select: { id: true, status: true, version: true },
        });
        const result: Result = {
          cancellationRequest: {
            ...created,
            orderItemId: item.id,
            decidedAt: null,
          },
        };
        await tx.auditLog.create({
          data: {
            restaurantId: principal.restaurantId,
            locationId: principal.locationId,
            actorType: 'GUEST_SESSION',
            actorId: principal.sessionId,
            action: 'CANCELLATION_REQUESTED',
            resourceType: 'CancellationRequest',
            resourceId: created.id,
            reason: input.reason,
            metadata: { orderItemId: item.id, tableSessionId: principal.tableSessionId },
            createdAt: now,
          },
        });
        await this.cancellationOutbox(tx, {
          restaurantId: principal.restaurantId,
          locationId: principal.locationId,
          requestId: created.id,
          tableSessionId: principal.tableSessionId!,
          version: created.version,
          occurredAt: now,
        });
        await tx.idempotencyRecord.create({
          data: {
            ...key,
            restaurantId: principal.restaurantId,
            requestHash,
            status: 'COMPLETED',
            responseStatus: 201,
            responseBody: result,
            resourceId: item.id,
            expiresAt: principal.absoluteExpiresAt,
          },
        });
        return result;
      });
    return this.retryUnique(execute);
  }

  decideWaiter(principal: StaffPrincipal, input: CancellationDecisionInput): Promise<Result> {
    return this.decide(principal, input, {
      operation: 'DECIDE_WAITER_CANCELLATION',
      permission: 'order.cancel_new',
      expectedRequestStatus: 'PENDING_WAITER',
      acceptedItemStatus: 'NEW',
    });
  }

  decideOperational(principal: StaffPrincipal, input: CancellationDecisionInput): Promise<Result> {
    return this.decide(principal, input, {
      operation: 'DECIDE_OPERATIONAL_CANCELLATION',
      permission: 'cancellation.decide_operational',
      expectedRequestStatus: 'PENDING_KITCHEN',
      acceptedItemStatus: 'PREPARING',
      stationRestricted: true,
    });
  }

  async forward(principal: StaffPrincipal, input: CancellationForwardInput): Promise<Result> {
    const target = await this.requestTarget(input.requestId, principal);
    const operation = 'FORWARD_CANCELLATION_TO_KITCHEN';
    const key = this.staffKey(principal, operation, input.idempotencyKey);
    const requestHash = this.hash(input);
    const execute = () =>
      this.prisma.$transaction(async (tx) => {
        await this.lockSessionAndBill(
          tx,
          target.tableSessionId,
          target.billId,
          principal.restaurantId,
          principal.locationId,
        );
        const expiresAt = await this.revalidateStaff(
          tx,
          principal,
          'cancellation.forward_to_kitchen',
        );
        const item = await this.lockItem(
          tx,
          target.orderItemId,
          principal.restaurantId,
          principal.locationId,
        );
        const request = await this.lockRequest(
          tx,
          input.requestId,
          principal.restaurantId,
          principal.locationId,
        );
        const replay = await this.replay(tx, key, requestHash, request.id);
        if (replay) return replay;
        if (request.version !== input.expectedVersion)
          throw conflict('CANCELLATION_VERSION_CONFLICT');
        if (request.status !== 'PENDING_WAITER' || item.status !== 'PREPARING')
          throw conflict('CANCELLATION_STATE_CONFLICT');
        if (!['KITCHEN', 'BAR'].includes(item.station))
          throw conflict('CANCELLATION_STATION_INVALID');
        const now = new Date();
        const updated = await tx.cancellationRequest.update({
          where: { id: request.id },
          data: { status: 'PENDING_KITCHEN', version: { increment: 1 }, updatedAt: now },
          select: { id: true, status: true, version: true },
        });
        const result: Result = {
          cancellationRequest: { ...updated, orderItemId: item.id, decidedAt: null },
        };
        await this.staffAudit(
          tx,
          principal,
          updated.id,
          'CANCELLATION_FORWARDED',
          input.reason,
          {
            orderItemId: item.id,
            tableSessionId: target.tableSessionId,
          },
          now,
        );
        await this.cancellationOutbox(tx, {
          ...targetScope(principal),
          requestId: updated.id,
          tableSessionId: target.tableSessionId,
          version: updated.version,
          occurredAt: now,
        });
        await this.completeStaffIdempotency(
          tx,
          principal.restaurantId,
          key,
          requestHash,
          updated.id,
          result,
          expiresAt,
        );
        return result;
      });
    return this.retryUnique(execute);
  }

  async rejectNewItem(principal: StaffPrincipal, input: DirectRejectionInput): Promise<Result> {
    const itemTarget = await this.prisma.orderItem.findFirst({
      where: {
        id: input.itemId,
        restaurantId: principal.restaurantId,
        locationId: principal.locationId,
      },
      select: { billId: true, order: { select: { tableSessionId: true } } },
    });
    if (!itemTarget) throw denied();
    const operation = 'REJECT_NEW_FULFILLMENT_ITEM';
    const key = this.staffKey(principal, operation, input.idempotencyKey);
    const requestHash = this.hash(input);
    const execute = () =>
      this.prisma.$transaction(async (tx) => {
        await this.lockSessionAndBill(
          tx,
          itemTarget.order.tableSessionId,
          itemTarget.billId,
          principal.restaurantId,
          principal.locationId,
        );
        const expiresAt = await this.revalidateStaff(
          tx,
          principal,
          'cancellation.decide_operational',
        );
        const item = await this.lockItem(
          tx,
          input.itemId,
          principal.restaurantId,
          principal.locationId,
        );
        const replay = await this.replay(tx, key, requestHash, item.id);
        if (replay) return replay;
        if (item.version !== input.expectedVersion)
          throw conflict('CANCELLATION_ITEM_VERSION_CONFLICT');
        if (item.status !== 'NEW') throw conflict('CANCELLATION_ITEM_STATE_CONFLICT');
        if (!['KITCHEN', 'BAR'].includes(item.station))
          throw conflict('CANCELLATION_STATION_INVALID');
        const pending = await tx.cancellationRequest.findFirst({
          where: { orderItemId: item.id, status: { in: ['PENDING_WAITER', 'PENDING_KITCHEN'] } },
          orderBy: { createdAt: 'asc' },
        });
        const now = new Date();
        const request = pending
          ? await tx.cancellationRequest.update({
              where: { id: pending.id },
              data: {
                status: 'APPROVED',
                decidedByMembershipId: principal.membershipId,
                decidedAt: now,
                decisionReason: input.reason,
                version: { increment: 1 },
                updatedAt: now,
              },
              select: { id: true, status: true, version: true },
            })
          : await tx.cancellationRequest.create({
              data: {
                restaurantId: principal.restaurantId,
                locationId: principal.locationId,
                tableSessionId: itemTarget.order.tableSessionId,
                billId: itemTarget.billId,
                orderItemId: item.id,
                source: 'STAFF_REJECTION',
                status: 'APPROVED',
                requestedByMembershipId: principal.membershipId,
                requestReason: input.reason,
                decidedByMembershipId: principal.membershipId,
                decidedAt: now,
                decisionReason: input.reason,
                createdAt: now,
                updatedAt: now,
              },
              select: { id: true, status: true, version: true },
            });
        const result = await this.applyWaiver(tx, principal, {
          request: {
            id: request.id,
            status: 'APPROVED',
            version: request.version,
            orderItemId: item.id,
          },
          item,
          billId: itemTarget.billId,
          tableSessionId: itemTarget.order.tableSessionId,
          reason: input.reason,
          now,
        });
        await this.completeStaffIdempotency(
          tx,
          principal.restaurantId,
          key,
          requestHash,
          item.id,
          result,
          expiresAt,
        );
        return result;
      });
    return this.retryUnique(execute);
  }

  private async decide(
    principal: StaffPrincipal,
    input: CancellationDecisionInput,
    rule: {
      operation: string;
      permission: string;
      expectedRequestStatus: 'PENDING_WAITER' | 'PENDING_KITCHEN';
      acceptedItemStatus: 'NEW' | 'PREPARING';
      stationRestricted?: boolean;
    },
  ): Promise<Result> {
    const target = await this.requestTarget(input.requestId, principal);
    const key = this.staffKey(principal, rule.operation, input.idempotencyKey);
    const requestHash = this.hash(input);
    const execute = () =>
      this.prisma.$transaction(async (tx) => {
        await this.lockSessionAndBill(
          tx,
          target.tableSessionId,
          target.billId,
          principal.restaurantId,
          principal.locationId,
        );
        const expiresAt = await this.revalidateStaff(tx, principal, rule.permission);
        const item = await this.lockItem(
          tx,
          target.orderItemId,
          principal.restaurantId,
          principal.locationId,
        );
        const request = await this.lockRequest(
          tx,
          input.requestId,
          principal.restaurantId,
          principal.locationId,
        );
        const replay = await this.replay(tx, key, requestHash, request.id);
        if (replay) return replay;
        if (request.version !== input.expectedVersion)
          throw conflict('CANCELLATION_VERSION_CONFLICT');
        if (request.status !== rule.expectedRequestStatus)
          throw conflict('CANCELLATION_STATE_CONFLICT');
        if (input.decision === 'ACCEPT' && item.status !== rule.acceptedItemStatus)
          throw conflict('CANCELLATION_ITEM_STATE_CONFLICT');
        if (
          input.decision === 'ACCEPT' &&
          rule.stationRestricted &&
          !['KITCHEN', 'BAR'].includes(item.station)
        )
          throw conflict('CANCELLATION_STATION_INVALID');
        const now = new Date();
        const updated = await tx.cancellationRequest.update({
          where: { id: request.id },
          data: {
            status: input.decision === 'ACCEPT' ? 'APPROVED' : 'REJECTED',
            decidedByMembershipId: principal.membershipId,
            decidedAt: now,
            decisionReason: input.reason,
            version: { increment: 1 },
            updatedAt: now,
          },
          select: { id: true, status: true, version: true },
        });
        const result =
          input.decision === 'ACCEPT'
            ? await this.applyWaiver(tx, principal, {
                request: {
                  id: updated.id,
                  status: 'APPROVED',
                  version: updated.version,
                  orderItemId: item.id,
                },
                item,
                billId: target.billId,
                tableSessionId: target.tableSessionId,
                reason: input.reason,
                now,
              })
            : await this.recordRejection(tx, principal, {
                request: {
                  id: updated.id,
                  status: 'REJECTED',
                  version: updated.version,
                  orderItemId: item.id,
                },
                tableSessionId: target.tableSessionId,
                reason: input.reason,
                now,
              });
        await this.completeStaffIdempotency(
          tx,
          principal.restaurantId,
          key,
          requestHash,
          updated.id,
          result,
          expiresAt,
        );
        return result;
      });
    return this.retryUnique(execute);
  }

  private async applyWaiver(
    tx: Prisma.TransactionClient,
    principal: StaffPrincipal,
    input: {
      request: { id: string; status: 'APPROVED'; version: number; orderItemId: string };
      item: LockedItem;
      billId: string;
      tableSessionId: string;
      reason: string;
      now: Date;
    },
  ): Promise<Result> {
    const line = await tx.billLine.findUnique({
      where: { orderItemId: input.item.id },
      select: { lineAmount: true },
    });
    if (!line) throw conflict('CANCELLATION_FINANCIAL_STATE_INVALID');
    const updatedItem = await tx.orderItem.update({
      where: { id: input.item.id, status: input.item.status, version: input.item.version },
      data: { status: 'CANCELLED', version: { increment: 1 } },
      select: { id: true, version: true },
    });
    const adjustment = await tx.billAdjustment.create({
      data: {
        ...targetScope(principal),
        billId: input.billId,
        orderItemId: input.item.id,
        cancellationRequestId: input.request.id,
        kind: 'FULL_CANCELLATION_WAIVER',
        amount: -line.lineAmount,
        reason: input.reason,
        createdByMembershipId: principal.membershipId,
        createdAt: input.now,
      },
      select: { id: true, kind: true, amount: true },
    });
    const bill = await tx.bill.findUniqueOrThrow({ where: { id: input.billId } });
    if (bill.status !== 'OPEN' || bill.paidAmount !== 0n)
      throw conflict('CANCELLATION_FINANCIAL_STATE_INVALID');
    const adjustmentAmount = bill.adjustmentAmount - line.lineAmount;
    const totalAmount = bill.subtotalAmount + adjustmentAmount;
    const balanceAmount = totalAmount - bill.paidAmount;
    if (totalAmount < 0n || balanceAmount < 0n)
      throw conflict('CANCELLATION_FINANCIAL_STATE_INVALID');
    const updatedBill = await tx.bill.update({
      where: { id: bill.id, version: bill.version },
      data: {
        adjustmentAmount,
        totalAmount,
        balanceAmount,
        version: { increment: 1 },
      },
      select: {
        id: true,
        adjustmentAmount: true,
        totalAmount: true,
        balanceAmount: true,
        version: true,
      },
    });
    const result: Result = {
      cancellationRequest: {
        id: input.request.id,
        orderItemId: input.item.id,
        status: 'APPROVED',
        version: input.request.version,
        decidedAt: input.now.toISOString(),
      },
      item: { ...updatedItem, status: 'CANCELLED' },
      bill: {
        ...updatedBill,
        adjustmentAmount: updatedBill.adjustmentAmount.toString(),
        totalAmount: updatedBill.totalAmount.toString(),
        balanceAmount: updatedBill.balanceAmount.toString(),
      },
      adjustment: { ...adjustment, amount: adjustment.amount.toString() },
    };
    await this.staffAudit(
      tx,
      principal,
      input.request.id,
      'CANCELLATION_APPROVED',
      input.reason,
      {
        orderItemId: input.item.id,
        tableSessionId: input.tableSessionId,
        itemStatusBefore: input.item.status,
        itemVersionBefore: input.item.version,
        itemVersionAfter: updatedItem.version,
        adjustmentId: adjustment.id,
        adjustmentAmount: adjustment.amount.toString(),
      },
      input.now,
    );
    await this.acceptedOutbox(tx, principal, {
      requestId: input.request.id,
      requestVersion: input.request.version,
      itemId: input.item.id,
      itemVersion: updatedItem.version,
      billId: updatedBill.id,
      billVersion: updatedBill.version,
      tableSessionId: input.tableSessionId,
      occurredAt: input.now,
    });
    return result;
  }

  private async recordRejection(
    tx: Prisma.TransactionClient,
    principal: StaffPrincipal,
    input: {
      request: { id: string; status: 'REJECTED'; version: number; orderItemId: string };
      tableSessionId: string;
      reason: string;
      now: Date;
    },
  ): Promise<Result> {
    const result: Result = {
      cancellationRequest: {
        ...input.request,
        decidedAt: input.now.toISOString(),
      },
    };
    await this.staffAudit(
      tx,
      principal,
      input.request.id,
      'CANCELLATION_REJECTED',
      input.reason,
      {
        orderItemId: input.request.orderItemId,
        tableSessionId: input.tableSessionId,
      },
      input.now,
    );
    await this.cancellationOutbox(tx, {
      ...targetScope(principal),
      requestId: input.request.id,
      tableSessionId: input.tableSessionId,
      version: input.request.version,
      occurredAt: input.now,
    });
    return result;
  }

  private async requestTarget(requestId: string, principal: StaffPrincipal) {
    const target = await this.prisma.cancellationRequest.findFirst({
      where: { id: requestId, ...targetScope(principal) },
      select: { tableSessionId: true, billId: true, orderItemId: true },
    });
    if (!target) throw denied();
    return target;
  }

  private async lockSessionAndBill(
    tx: Prisma.TransactionClient,
    tableSessionId: string,
    billId: string,
    restaurantId: string,
    locationId: string,
  ): Promise<void> {
    const sessions = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "table_session" WHERE "id" = ${tableSessionId}::uuid
        AND "restaurant_id" = ${restaurantId}::uuid AND "location_id" = ${locationId}::uuid
        AND "status" = 'ACTIVE' FOR UPDATE`;
    if (!sessions[0]) throw denied();
    const bills = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "bill" WHERE "id" = ${billId}::uuid
        AND "table_session_id" = ${tableSessionId}::uuid AND "status" = 'OPEN' FOR UPDATE`;
    if (!bills[0]) throw conflict('CANCELLATION_FINANCIAL_STATE_INVALID');
  }

  private async revalidateGuest(tx: Prisma.TransactionClient, principal: GuestPrincipal) {
    const rows = await tx.$queryRaw<Array<{ expiresAt: Date }>>`
      SELECT LEAST(gs."idle_expires_at", gs."absolute_expires_at") AS "expiresAt"
      FROM "guest_session" gs
      WHERE gs."id" = ${principal.sessionId}::uuid
        AND gs."restaurant_id" = ${principal.restaurantId}::uuid
        AND gs."location_id" = ${principal.locationId}::uuid
        AND gs."table_session_id" = ${principal.tableSessionId}::uuid
        AND gs."access_level" = 'ORDER_ENABLED' AND gs."revoked_at" IS NULL
        AND gs."idle_expires_at" > clock_timestamp()
        AND gs."absolute_expires_at" > clock_timestamp()
      FOR SHARE`;
    if (!rows[0]) throw new UnauthorizedException({ code: 'GUEST_SESSION_INVALID' });
    return rows[0].expiresAt;
  }

  private async revalidateStaff(
    tx: Prisma.TransactionClient,
    principal: StaffPrincipal,
    permission: string,
  ): Promise<Date> {
    const rows = await tx.$queryRaw<Array<{ expiresAt: Date }>>`
      SELECT ss."expires_at" AS "expiresAt" FROM "staff_session" ss
      JOIN "staff_membership" sm ON sm."id" = ss."membership_id" AND sm."staff_user_id" = ss."staff_user_id"
      JOIN "staff_user" su ON su."id" = ss."staff_user_id"
      JOIN "location" l ON l."id" = sm."location_id" AND l."restaurant_id" = sm."restaurant_id"
      JOIN "restaurant" r ON r."id" = sm."restaurant_id"
      WHERE ss."id" = ${principal.sessionId}::uuid AND ss."staff_user_id" = ${principal.staffUserId}::uuid
        AND sm."id" = ${principal.membershipId}::uuid AND sm."restaurant_id" = ${principal.restaurantId}::uuid
        AND sm."location_id" = ${principal.locationId}::uuid AND ss."revoked_at" IS NULL
        AND ss."expires_at" > clock_timestamp() AND sm."status" = 'ACTIVE' AND su."status" = 'ACTIVE'
        AND l."is_active" = true AND r."status" = 'ACTIVE' FOR SHARE OF ss, sm, su, l, r`;
    if (!rows[0]) throw new UnauthorizedException({ code: 'STAFF_SESSION_INVALID' });
    const permissions = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT p."id" FROM "membership_role" mr
      JOIN "role_permission" rp ON rp."role_id" = mr."role_id"
      JOIN "permission" p ON p."id" = rp."permission_id"
      WHERE mr."membership_id" = ${principal.membershipId}::uuid
        AND mr."restaurant_id" = ${principal.restaurantId}::uuid
        AND p."code" = ${permission} FOR SHARE OF mr, rp, p`;
    if (!permissions[0]) throw denied();
    return rows[0].expiresAt;
  }

  private async lockItem(
    tx: Prisma.TransactionClient,
    itemId: string,
    restaurantId: string,
    locationId: string,
  ): Promise<LockedItem> {
    const rows = await tx.$queryRaw<LockedItem[]>`
      SELECT "id", "status", "station_snapshot" AS "station", "version"
      FROM "order_item" WHERE "id" = ${itemId}::uuid
        AND "restaurant_id" = ${restaurantId}::uuid AND "location_id" = ${locationId}::uuid
      FOR UPDATE`;
    if (!rows[0]) throw denied();
    return rows[0];
  }

  private async lockRequest(
    tx: Prisma.TransactionClient,
    requestId: string,
    restaurantId: string,
    locationId: string,
  ): Promise<LockedRequest> {
    const rows = await tx.$queryRaw<LockedRequest[]>`
      SELECT "id", "status", "version", "order_item_id" AS "orderItemId"
      FROM "cancellation_request" WHERE "id" = ${requestId}::uuid
        AND "restaurant_id" = ${restaurantId}::uuid AND "location_id" = ${locationId}::uuid
      FOR UPDATE`;
    if (!rows[0]) throw denied();
    return rows[0];
  }

  private async replay(
    tx: Prisma.TransactionClient,
    key: ReturnType<CancellationService['staffKey']>,
    requestHash: string,
    resourceId: string,
  ): Promise<Result | null> {
    const replay = await tx.idempotencyRecord.findUnique({
      where: { actorType_actorId_operation_idempotencyKey: key },
    });
    if (!replay) return null;
    if (replay.resourceId !== resourceId || replay.requestHash !== requestHash)
      throw conflict('IDEMPOTENCY_KEY_REUSED');
    return replay.responseBody as unknown as Result;
  }

  private async completeStaffIdempotency(
    tx: Prisma.TransactionClient,
    restaurantId: string,
    key: ReturnType<CancellationService['staffKey']>,
    requestHash: string,
    resourceId: string,
    result: Result,
    expiresAt: Date,
  ): Promise<void> {
    await tx.idempotencyRecord.create({
      data: {
        ...key,
        restaurantId,
        requestHash,
        status: 'COMPLETED',
        responseStatus: 200,
        responseBody: result,
        resourceId,
        expiresAt,
      },
    });
  }

  private staffKey(principal: StaffPrincipal, operation: string, idempotencyKey: string) {
    return {
      actorType: 'STAFF_MEMBERSHIP' as const,
      actorId: principal.membershipId,
      operation,
      idempotencyKey,
    };
  }

  private hash(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  private async staffAudit(
    tx: Prisma.TransactionClient,
    principal: StaffPrincipal,
    resourceId: string,
    action: string,
    reason: string,
    metadata: Prisma.InputJsonValue,
    createdAt: Date,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        ...targetScope(principal),
        actorType: 'STAFF_MEMBERSHIP',
        actorId: principal.membershipId,
        action,
        resourceType: 'CancellationRequest',
        resourceId,
        reason,
        metadata,
        createdAt,
      },
    });
  }

  private async cancellationOutbox(
    tx: Prisma.TransactionClient,
    input: {
      restaurantId: string;
      locationId: string;
      requestId: string;
      tableSessionId: string;
      version: number;
      occurredAt: Date;
    },
  ): Promise<void> {
    await tx.outboxEvent.create({
      data: {
        restaurantId: input.restaurantId,
        locationId: input.locationId,
        aggregateType: 'CancellationRequest',
        aggregateId: input.requestId,
        eventType: 'cancellation.updated',
        occurredAt: input.occurredAt,
        payload: {
          id: input.requestId,
          tableSessionId: input.tableSessionId,
          version: input.version,
        },
      },
    });
  }

  private async acceptedOutbox(
    tx: Prisma.TransactionClient,
    principal: StaffPrincipal,
    input: {
      requestId: string;
      requestVersion: number;
      itemId: string;
      itemVersion: number;
      billId: string;
      billVersion: number;
      tableSessionId: string;
      occurredAt: Date;
    },
  ): Promise<void> {
    await this.cancellationOutbox(tx, {
      ...targetScope(principal),
      requestId: input.requestId,
      tableSessionId: input.tableSessionId,
      version: input.requestVersion,
      occurredAt: input.occurredAt,
    });
    await tx.outboxEvent.createMany({
      data: [
        {
          ...targetScope(principal),
          aggregateType: 'OrderItem',
          aggregateId: input.itemId,
          eventType: 'fulfillment.item.updated',
          occurredAt: input.occurredAt,
          payload: {
            id: input.itemId,
            tableSessionId: input.tableSessionId,
            status: 'CANCELLED',
            version: input.itemVersion,
          },
        },
        {
          ...targetScope(principal),
          aggregateType: 'Bill',
          aggregateId: input.billId,
          eventType: 'bill.updated',
          occurredAt: input.occurredAt,
          payload: {
            id: input.billId,
            tableSessionId: input.tableSessionId,
            version: input.billVersion,
          },
        },
      ],
    });
  }

  private async retryUnique<T>(execute: () => Promise<T>): Promise<T> {
    try {
      return await execute();
    } catch (error) {
      if (!isUniqueError(error)) throw error;
      return execute();
    }
  }
}

function targetScope(principal: { restaurantId: string; locationId: string }) {
  return { restaurantId: principal.restaurantId, locationId: principal.locationId };
}

function isUniqueError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}
