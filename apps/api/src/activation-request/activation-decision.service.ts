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
import {
  ActivationRequestStatus,
  AuditActorType,
  IdempotencyActorType,
  IdempotencyRecordStatus,
  TablePhysicalStatus,
  TableSessionStatus,
} from '../generated/prisma/enums.js';
import type {
  ApproveActivationInput,
  ApproveActivationResponse,
  RejectActivationInput,
  RejectActivationResponse,
} from './activation-request.types.js';

const APPROVE_OPERATION = 'APPROVE_ACTIVATION';
const REJECT_OPERATION = 'REJECT_ACTIVATION';
const REQUIRED_PERMISSION = 'table.activation.approve';

type Decision =
  | { kind: 'approve'; input: ApproveActivationInput }
  | { kind: 'reject'; input: RejectActivationInput };

type DecisionResponse = ApproveActivationResponse | RejectActivationResponse;

type LockedTable = {
  id: string;
  publicId: string;
  physicalStatus: TablePhysicalStatus;
  version: number;
  isActive: boolean;
};

type LockedActivation = {
  id: string;
  tableId: string;
  status: ActivationRequestStatus;
  expiresAt: Date;
  version: number;
};

function hashRequest(value: object): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

function authorizationDenied(): ForbiddenException {
  return new ForbiddenException({
    code: 'STAFF_AUTHORIZATION_DENIED',
    message: 'You are not authorized for this resource.',
    details: {},
  });
}

function invalidStaffSession(): UnauthorizedException {
  return new UnauthorizedException({
    code: 'STAFF_SESSION_INVALID',
    message: 'Staff session is missing, expired, or revoked.',
    details: {},
  });
}

function idempotencyConflict(): ConflictException {
  return new ConflictException({
    code: 'IDEMPOTENCY_KEY_REUSED',
    message: 'Idempotency-Key was already used with a different request.',
    details: {},
  });
}

function versionConflict(): ConflictException {
  return new ConflictException({
    code: 'ACTIVATION_VERSION_CONFLICT',
    message: 'The activation request version is stale.',
    details: {},
  });
}

function requestNotPending(): ConflictException {
  return new ConflictException({
    code: 'ACTIVATION_REQUEST_NOT_PENDING',
    message: 'The activation request is no longer pending.',
    details: {},
  });
}

function requestExpired(): ConflictException {
  return new ConflictException({
    code: 'ACTIVATION_REQUEST_EXPIRED',
    message: 'The activation request has expired.',
    details: {},
  });
}

function tableNotAvailable(): ConflictException {
  return new ConflictException({
    code: 'TABLE_NOT_AVAILABLE',
    message: 'The table is not available for activation.',
    details: {},
  });
}

@Injectable()
export class ActivationDecisionService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async approve(input: ApproveActivationInput): Promise<ApproveActivationResponse> {
    return (await this.execute({ kind: 'approve', input })) as ApproveActivationResponse;
  }

  async reject(input: RejectActivationInput): Promise<RejectActivationResponse> {
    return (await this.execute({ kind: 'reject', input })) as RejectActivationResponse;
  }

  private async execute(decision: Decision): Promise<DecisionResponse> {
    const { input } = decision;
    const operation = decision.kind === 'approve' ? APPROVE_OPERATION : REJECT_OPERATION;
    const requestHash = hashRequest(
      decision.kind === 'approve'
        ? {
            activationRequestId: decision.input.activationRequestId,
            expectedVersion: decision.input.expectedVersion,
            physicalPresenceConfirmed: true,
          }
        : {
            activationRequestId: decision.input.activationRequestId,
            expectedVersion: decision.input.expectedVersion,
            reason: decision.input.reason,
          },
    );

    const scopedRequest = await this.prisma.activationRequest.findFirst({
      where: {
        id: input.activationRequestId,
        restaurantId: input.principal.restaurantId,
        locationId: input.principal.locationId,
      },
      select: { tableId: true },
    });
    if (!scopedRequest) throw authorizationDenied();

    try {
      const outcome = await this.prisma.$transaction(async (transaction) => {
        const tables = await transaction.$queryRaw<LockedTable[]>`
          SELECT
            "id",
            "public_id" AS "publicId",
            "physical_status" AS "physicalStatus",
            "version",
            "is_active" AS "isActive"
          FROM "restaurant_table"
          WHERE "id" = ${scopedRequest.tableId}::uuid
            AND "restaurant_id" = ${input.principal.restaurantId}::uuid
            AND "location_id" = ${input.principal.locationId}::uuid
          FOR UPDATE
        `;
        const table = tables[0];
        if (!table) throw authorizationDenied();

        const requests = await transaction.$queryRaw<LockedActivation[]>`
          SELECT
            "id",
            "table_id" AS "tableId",
            "status",
            "expires_at" AS "expiresAt",
            "version"
          FROM "activation_request"
          WHERE "id" = ${input.activationRequestId}::uuid
            AND "table_id" = ${table.id}::uuid
            AND "restaurant_id" = ${input.principal.restaurantId}::uuid
            AND "location_id" = ${input.principal.locationId}::uuid
          FOR UPDATE
        `;
        const activation = requests[0];
        if (!activation) throw authorizationDenied();
        const commandNow = new Date();

        const staffSessionExpiresAt = await this.revalidateStaff(transaction, input.principal);

        const replay = await transaction.idempotencyRecord.findUnique({
          where: {
            actorType_actorId_operation_idempotencyKey: {
              actorType: IdempotencyActorType.STAFF_MEMBERSHIP,
              actorId: input.principal.membershipId,
              operation,
              idempotencyKey: input.idempotencyKey,
            },
          },
        });
        if (replay) {
          if (
            replay.requestHash !== requestHash ||
            replay.resourceId !== input.activationRequestId
          ) {
            throw idempotencyConflict();
          }
          return { kind: 'success', data: replay.responseBody as DecisionResponse } as const;
        }

        if (
          activation.status === ActivationRequestStatus.PENDING &&
          activation.expiresAt.getTime() <= commandNow.getTime()
        ) {
          await transaction.activationRequest.update({
            where: { id: activation.id },
            data: { status: ActivationRequestStatus.EXPIRED, version: { increment: 1 } },
          });
          return { kind: 'expired' } as const;
        }
        if (activation.status !== ActivationRequestStatus.PENDING) throw requestNotPending();
        if (activation.version !== input.expectedVersion) throw versionConflict();

        if (decision.kind === 'approve') {
          if (!table.isActive || table.physicalStatus !== TablePhysicalStatus.AVAILABLE) {
            throw tableNotAvailable();
          }
          const existingActiveSession = await transaction.tableSession.findFirst({
            where: {
              tableId: table.id,
              status: { in: [TableSessionStatus.ACTIVE, TableSessionStatus.CHECKOUT_LOCKED] },
            },
            select: { id: true },
          });
          if (existingActiveSession) throw tableNotAvailable();

          const updatedActivation = await transaction.activationRequest.update({
            where: { id: activation.id },
            data: {
              status: ActivationRequestStatus.APPROVED,
              handledByMembershipId: input.principal.membershipId,
              handledAt: commandNow,
              version: { increment: 1 },
            },
            select: { id: true, status: true, version: true, handledAt: true },
          });
          const tableSession = await transaction.tableSession.create({
            data: {
              restaurantId: input.principal.restaurantId,
              locationId: input.principal.locationId,
              tableId: table.id,
              activationRequestId: activation.id,
              activatedByMembershipId: input.principal.membershipId,
              activatedAt: commandNow,
            },
            select: { id: true, status: true, version: true },
          });
          const bill = await transaction.bill.create({
            data: {
              restaurantId: input.principal.restaurantId,
              locationId: input.principal.locationId,
              tableSessionId: tableSession.id,
            },
            select: {
              id: true,
              status: true,
              subtotalAmount: true,
              adjustmentAmount: true,
              totalAmount: true,
              paidAmount: true,
              balanceAmount: true,
              version: true,
            },
          });
          const updatedTable = await transaction.restaurantTable.update({
            where: { id: table.id },
            data: { physicalStatus: TablePhysicalStatus.OCCUPIED, version: { increment: 1 } },
            select: { publicId: true, physicalStatus: true, version: true },
          });

          const data: ApproveActivationResponse = {
            activationRequest: {
              id: updatedActivation.id,
              status: 'APPROVED',
              version: updatedActivation.version,
              handledAt: updatedActivation.handledAt!.toISOString(),
            },
            table: {
              publicId: updatedTable.publicId,
              physicalStatus: 'OCCUPIED',
              version: updatedTable.version,
            },
            tableSession: {
              id: tableSession.id,
              status: 'ACTIVE',
              version: tableSession.version,
            },
            bill: {
              id: bill.id,
              status: 'OPEN',
              subtotalAmount: bill.subtotalAmount.toString(),
              adjustmentAmount: bill.adjustmentAmount.toString(),
              totalAmount: bill.totalAmount.toString(),
              paidAmount: bill.paidAmount.toString(),
              balanceAmount: bill.balanceAmount.toString(),
              version: bill.version,
            },
          };

          await transaction.auditLog.create({
            data: {
              restaurantId: input.principal.restaurantId,
              locationId: input.principal.locationId,
              actorType: AuditActorType.STAFF_MEMBERSHIP,
              actorId: input.principal.membershipId,
              action: 'ACTIVATION_APPROVED',
              resourceType: 'ActivationRequest',
              resourceId: activation.id,
              metadata: {
                physicalPresenceConfirmed: true,
                tableId: table.id,
                tableSessionId: tableSession.id,
                billId: bill.id,
                requestVersionBefore: activation.version,
                requestVersionAfter: updatedActivation.version,
                tableVersionBefore: table.version,
                tableVersionAfter: updatedTable.version,
              },
            },
          });
          await transaction.outboxEvent.createMany({
            data: [
              {
                restaurantId: input.principal.restaurantId,
                locationId: input.principal.locationId,
                aggregateType: 'ActivationRequest',
                aggregateId: activation.id,
                eventType: 'activation.updated',
                payload: {
                  id: activation.id,
                  tableId: table.id,
                  status: 'APPROVED',
                  version: updatedActivation.version,
                  occurredAt: commandNow.toISOString(),
                },
                occurredAt: commandNow,
              },
              {
                restaurantId: input.principal.restaurantId,
                locationId: input.principal.locationId,
                aggregateType: 'TableSession',
                aggregateId: tableSession.id,
                eventType: 'table.session.updated',
                payload: {
                  id: tableSession.id,
                  tableId: table.id,
                  status: 'ACTIVE',
                  version: tableSession.version,
                  occurredAt: commandNow.toISOString(),
                },
                occurredAt: commandNow,
              },
            ],
          });
          await this.persistIdempotency(
            transaction,
            input,
            operation,
            requestHash,
            data,
            staffSessionExpiresAt,
          );
          return { kind: 'success', data } as const;
        }

        const updatedActivation = await transaction.activationRequest.update({
          where: { id: activation.id },
          data: {
            status: ActivationRequestStatus.REJECTED,
            handledByMembershipId: input.principal.membershipId,
            handledAt: commandNow,
            rejectionReason: decision.input.reason,
            version: { increment: 1 },
          },
          select: {
            id: true,
            status: true,
            version: true,
            handledAt: true,
            rejectionReason: true,
          },
        });
        const data: RejectActivationResponse = {
          activationRequest: {
            id: updatedActivation.id,
            status: 'REJECTED',
            version: updatedActivation.version,
            handledAt: updatedActivation.handledAt!.toISOString(),
            rejectionReason: updatedActivation.rejectionReason!,
          },
        };

        await transaction.auditLog.create({
          data: {
            restaurantId: input.principal.restaurantId,
            locationId: input.principal.locationId,
            actorType: AuditActorType.STAFF_MEMBERSHIP,
            actorId: input.principal.membershipId,
            action: 'ACTIVATION_REJECTED',
            resourceType: 'ActivationRequest',
            resourceId: activation.id,
            reason: decision.input.reason,
            metadata: {
              tableId: table.id,
              requestVersionBefore: activation.version,
              requestVersionAfter: updatedActivation.version,
            },
          },
        });
        await transaction.outboxEvent.create({
          data: {
            restaurantId: input.principal.restaurantId,
            locationId: input.principal.locationId,
            aggregateType: 'ActivationRequest',
            aggregateId: activation.id,
            eventType: 'activation.updated',
            payload: {
              id: activation.id,
              tableId: table.id,
              status: 'REJECTED',
              version: updatedActivation.version,
              occurredAt: commandNow.toISOString(),
            },
            occurredAt: commandNow,
          },
        });
        await this.persistIdempotency(
          transaction,
          input,
          operation,
          requestHash,
          data,
          staffSessionExpiresAt,
        );
        return { kind: 'success', data } as const;
      });

      if (outcome.kind === 'expired') throw requestExpired();
      return outcome.data;
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const replay = await this.prisma.idempotencyRecord.findUnique({
        where: {
          actorType_actorId_operation_idempotencyKey: {
            actorType: IdempotencyActorType.STAFF_MEMBERSHIP,
            actorId: input.principal.membershipId,
            operation,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (replay) {
        if (replay.requestHash !== requestHash || replay.resourceId !== input.activationRequestId) {
          throw idempotencyConflict();
        }
        return replay.responseBody as DecisionResponse;
      }
      throw tableNotAvailable();
    }
  }

  private async revalidateStaff(
    transaction: Prisma.TransactionClient,
    principal: ApproveActivationInput['principal'],
  ): Promise<Date> {
    const sessions = await transaction.$queryRaw<Array<{ expiresAt: Date }>>`
      SELECT ss."expires_at" AS "expiresAt"
      FROM "staff_session" ss
      JOIN "staff_user" su ON su."id" = ss."staff_user_id"
      JOIN "staff_membership" sm
        ON sm."id" = ss."membership_id" AND sm."staff_user_id" = ss."staff_user_id"
      JOIN "location" l
        ON l."id" = sm."location_id" AND l."restaurant_id" = sm."restaurant_id"
      JOIN "restaurant" r ON r."id" = sm."restaurant_id"
      WHERE ss."id" = ${principal.sessionId}::uuid
        AND ss."staff_user_id" = ${principal.staffUserId}::uuid
        AND ss."membership_id" = ${principal.membershipId}::uuid
        AND sm."restaurant_id" = ${principal.restaurantId}::uuid
        AND sm."location_id" = ${principal.locationId}::uuid
        AND ss."revoked_at" IS NULL
        AND ss."expires_at" > clock_timestamp()
        AND su."status" = 'ACTIVE'
        AND sm."status" = 'ACTIVE'
        AND l."is_active" = true
        AND r."status" = 'ACTIVE'
      FOR SHARE OF ss, su, sm, l, r
    `;
    const session = sessions[0];
    if (!session) throw invalidStaffSession();

    const permissions = await transaction.$queryRaw<Array<{ allowed: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM "membership_role" mr
        JOIN "role_permission" rp ON rp."role_id" = mr."role_id"
        JOIN "permission" p ON p."id" = rp."permission_id"
        WHERE mr."membership_id" = ${principal.membershipId}::uuid
          AND mr."restaurant_id" = ${principal.restaurantId}::uuid
          AND p."code" = ${REQUIRED_PERMISSION}
      ) AS "allowed"
    `;
    if (!permissions[0]?.allowed) throw authorizationDenied();
    return session.expiresAt;
  }

  private async persistIdempotency(
    transaction: Prisma.TransactionClient,
    input: ApproveActivationInput | RejectActivationInput,
    operation: string,
    requestHash: string,
    response: DecisionResponse,
    expiresAt: Date,
  ): Promise<void> {
    await transaction.idempotencyRecord.create({
      data: {
        restaurantId: input.principal.restaurantId,
        actorType: IdempotencyActorType.STAFF_MEMBERSHIP,
        actorId: input.principal.membershipId,
        operation,
        idempotencyKey: input.idempotencyKey,
        requestHash,
        status: IdempotencyRecordStatus.COMPLETED,
        responseStatus: 200,
        responseBody: response,
        resourceId: input.activationRequestId,
        expiresAt,
      },
    });
  }
}
