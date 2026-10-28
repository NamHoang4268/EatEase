import { createHash } from 'node:crypto';
import { ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { loadEnvironment } from '../config/environment.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  ActivationRequestStatus,
  GuestAccessLevel,
  IdempotencyActorType,
  IdempotencyRecordStatus,
  RestaurantStatus,
  TablePhysicalStatus,
} from '../generated/prisma/enums.js';
import type {
  ActivationCommandResult,
  ActivationGuestResponse,
  RequestActivationInput,
  StaffActivationQueueInput,
  StaffActivationQueueItem,
} from './activation-request.types.js';

const REQUEST_ACTIVATION_OPERATION = 'REQUEST_ACTIVATION';

function fingerprint(tablePublicId: string): string {
  return createHash('sha256').update(JSON.stringify({ tablePublicId })).digest('hex');
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

function idempotencyConflict(): ConflictException {
  return new ConflictException({
    code: 'IDEMPOTENCY_KEY_REUSED',
    message: 'Idempotency-Key was already used with a different request.',
    details: {},
  });
}

@Injectable()
export class ActivationRequestService {
  private readonly requestTtlMs: number;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    let ttlMinutes = 5;
    try {
      ttlMinutes = loadEnvironment().ACTIVATION_REQUEST_TTL_MINUTES;
    } catch {
      // Unit tests can construct the service without a complete process environment.
    }
    this.requestTtlMs = ttlMinutes * 60 * 1_000;
  }

  async requestActivation(
    input: RequestActivationInput,
    now = new Date(),
  ): Promise<ActivationCommandResult> {
    const requestHash = fingerprint(input.tablePublicId);
    const replay = await this.findReplay(input, requestHash);
    if (replay) return replay;

    if (input.tablePublicId !== input.principal.tablePublicId) {
      throw new ForbiddenException({
        code: 'ACTIVATION_TABLE_SCOPE_MISMATCH',
        message: 'The activation request does not match the authenticated table.',
        details: {},
      });
    }
    if (input.principal.accessLevel !== GuestAccessLevel.BROWSE_ONLY) {
      throw new ConflictException({
        code: 'ACTIVATION_NOT_ELIGIBLE',
        message: 'This guest session is not eligible to request activation.',
        details: {},
      });
    }

    try {
      return await this.prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`
          SELECT "id"
          FROM "restaurant_table"
          WHERE "id" = ${input.principal.tableId}::uuid
          FOR UPDATE
        `;

        const transactionReplay = await transaction.idempotencyRecord.findUnique({
          where: {
            actorType_actorId_operation_idempotencyKey: {
              actorType: IdempotencyActorType.GUEST_SESSION,
              actorId: input.principal.sessionId,
              operation: REQUEST_ACTIVATION_OPERATION,
              idempotencyKey: input.idempotencyKey,
            },
          },
        });
        if (transactionReplay) {
          if (transactionReplay.requestHash !== requestHash) throw idempotencyConflict();
          return this.mapReplay(transactionReplay.responseStatus, transactionReplay.responseBody);
        }

        const table = await transaction.restaurantTable.findFirst({
          where: {
            id: input.principal.tableId,
            publicId: input.tablePublicId,
            restaurantId: input.principal.restaurantId,
            locationId: input.principal.locationId,
            isActive: true,
            physicalStatus: TablePhysicalStatus.AVAILABLE,
            location: {
              isActive: true,
              restaurant: { status: RestaurantStatus.ACTIVE },
            },
          },
          select: { id: true },
        });
        if (!table) {
          throw new ConflictException({
            code: 'TABLE_NOT_AVAILABLE_FOR_ACTIVATION',
            message: 'This table is not currently available for activation.',
            details: {},
          });
        }

        await transaction.activationRequest.updateMany({
          where: {
            tableId: input.principal.tableId,
            status: ActivationRequestStatus.PENDING,
            expiresAt: { lte: now },
          },
          data: {
            status: ActivationRequestStatus.EXPIRED,
            version: { increment: 1 },
          },
        });

        const pending = await transaction.activationRequest.findFirst({
          where: {
            tableId: input.principal.tableId,
            status: ActivationRequestStatus.PENDING,
            expiresAt: { gt: now },
          },
          select: {
            id: true,
            requesterGuestSessionId: true,
            expiresAt: true,
          },
        });

        const activation =
          pending ??
          (await transaction.activationRequest.create({
            data: {
              restaurantId: input.principal.restaurantId,
              locationId: input.principal.locationId,
              tableId: input.principal.tableId,
              requesterGuestSessionId: input.principal.sessionId,
              expiresAt: new Date(now.getTime() + this.requestTtlMs),
            },
            select: {
              id: true,
              requesterGuestSessionId: true,
              expiresAt: true,
            },
          }));

        const created = pending === null;
        const data: ActivationGuestResponse = {
          status: 'PENDING',
          expiresAt: activation.expiresAt.toISOString(),
          ...(activation.requesterGuestSessionId === input.principal.sessionId
            ? { activationRequestId: activation.id }
            : {}),
        };
        const statusCode = created ? 202 : 200;

        await transaction.idempotencyRecord.create({
          data: {
            restaurantId: input.principal.restaurantId,
            actorType: IdempotencyActorType.GUEST_SESSION,
            actorId: input.principal.sessionId,
            operation: REQUEST_ACTIVATION_OPERATION,
            idempotencyKey: input.idempotencyKey,
            requestHash,
            status: IdempotencyRecordStatus.COMPLETED,
            responseStatus: statusCode,
            responseBody: data,
            resourceId: activation.id,
            expiresAt: input.principal.absoluteExpiresAt,
          },
        });

        return { statusCode, data };
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const replayAfterRace = await this.findReplay(input, requestHash);
      if (replayAfterRace) return replayAfterRace;

      // The partial unique index is the final guard if another actor won a race.
      const pending = await this.prisma.activationRequest.findFirst({
        where: {
          tableId: input.principal.tableId,
          status: ActivationRequestStatus.PENDING,
          expiresAt: { gt: now },
        },
        select: { expiresAt: true },
      });
      if (pending) {
        return {
          statusCode: 200,
          data: { status: 'PENDING', expiresAt: pending.expiresAt.toISOString() },
        };
      }
      throw error;
    }
  }

  async getCurrent(
    principal: RequestActivationInput['principal'],
    now = new Date(),
  ): Promise<ActivationGuestResponse> {
    const pending = await this.prisma.activationRequest.findFirst({
      where: {
        tableId: principal.tableId,
        status: ActivationRequestStatus.PENDING,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, requesterGuestSessionId: true, expiresAt: true },
    });
    if (pending) {
      return {
        status: 'PENDING',
        expiresAt: pending.expiresAt.toISOString(),
        ...(pending.requesterGuestSessionId === principal.sessionId
          ? { activationRequestId: pending.id }
          : {}),
      };
    }

    const latestOwnRequest = await this.prisma.activationRequest.findFirst({
      where: { requesterGuestSessionId: principal.sessionId, tableId: principal.tableId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, expiresAt: true },
    });
    if (!latestOwnRequest) return { status: 'NOT_REQUESTED' };

    const status =
      latestOwnRequest.status === ActivationRequestStatus.PENDING &&
      latestOwnRequest.expiresAt.getTime() <= now.getTime()
        ? ActivationRequestStatus.EXPIRED
        : latestOwnRequest.status;
    return {
      status,
      activationRequestId: latestOwnRequest.id,
      expiresAt: latestOwnRequest.expiresAt.toISOString(),
    };
  }

  async getStaffQueue(
    input: StaffActivationQueueInput,
    now = new Date(),
  ): Promise<StaffActivationQueueItem[]> {
    const requests = await this.prisma.activationRequest.findMany({
      where: {
        restaurantId: input.principal.restaurantId,
        locationId: input.principal.locationId,
        status: ActivationRequestStatus.PENDING,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        status: true,
        createdAt: true,
        expiresAt: true,
        version: true,
        table: { select: { publicId: true, code: true, capacity: true } },
      },
    });

    return requests.map((request) => ({
      id: request.id,
      status: 'PENDING',
      createdAt: request.createdAt.toISOString(),
      expiresAt: request.expiresAt.toISOString(),
      version: request.version,
      table: request.table,
    }));
  }

  private async findReplay(
    input: RequestActivationInput,
    requestHash: string,
  ): Promise<ActivationCommandResult | null> {
    const record = await this.prisma.idempotencyRecord.findUnique({
      where: {
        actorType_actorId_operation_idempotencyKey: {
          actorType: IdempotencyActorType.GUEST_SESSION,
          actorId: input.principal.sessionId,
          operation: REQUEST_ACTIVATION_OPERATION,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (!record) return null;
    if (record.requestHash !== requestHash) throw idempotencyConflict();
    return this.mapReplay(record.responseStatus, record.responseBody);
  }

  private mapReplay(responseStatus: number, responseBody: unknown): ActivationCommandResult {
    return {
      statusCode: responseStatus === 202 ? 202 : 200,
      data: responseBody as ActivationGuestResponse,
    };
  }
}
