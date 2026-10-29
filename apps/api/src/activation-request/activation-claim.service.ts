import { createHash } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { loadEnvironment } from '../config/environment.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  ActivationRequestStatus,
  AuditActorType,
  GuestAccessLevel,
  IdempotencyActorType,
  IdempotencyRecordStatus,
  TableSessionStatus,
} from '../generated/prisma/enums.js';
import type { Prisma } from '../generated/prisma/client.js';
import { generateOpaqueToken, hashToken, tokensMatch } from '../staff-auth/auth.crypto.js';
import type {
  ClaimActivationData,
  ClaimActivationInput,
  ClaimActivationResult,
} from './activation-request.types.js';

const CLAIM_ACTIVATION_OPERATION = 'CLAIM_ACTIVATION';

type LockedActivation = {
  id: string;
  restaurantId: string;
  locationId: string;
  tableId: string;
  requesterGuestSessionId: string;
  status: ActivationRequestStatus;
  version: number;
};

type LockedTableSession = {
  id: string;
  status: TableSessionStatus;
};

type LockedGuestSession = {
  id: string;
  restaurantId: string;
  locationId: string;
  tableId: string;
  tableSessionId: string | null;
  tokenHash: string;
  csrfTokenHash: string;
  previousTokenHash: string | null;
  previousCsrfTokenHash: string | null;
  previousTokenValidUntil: Date | null;
  accessLevel: GuestAccessLevel;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
  version: number;
  tableActive: boolean;
  locationActive: boolean;
  restaurantActive: boolean;
};

function requestFingerprint(expectedVersion: number): string {
  return createHash('sha256').update(JSON.stringify({ expectedVersion })).digest('hex');
}

function invalidGuestSession(): UnauthorizedException {
  return new UnauthorizedException({
    code: 'GUEST_SESSION_INVALID',
    message: 'Guest session is missing, expired, or revoked.',
    details: {},
  });
}

function invalidCsrf(): ForbiddenException {
  return new ForbiddenException({
    code: 'GUEST_CSRF_INVALID',
    message: 'CSRF validation failed.',
    details: {},
  });
}

function claimNotAllowed(): ForbiddenException {
  return new ForbiddenException({
    code: 'ACTIVATION_CLAIM_NOT_ALLOWED',
    message: 'This guest session cannot claim the activation request.',
    details: {},
  });
}

function claimNotAvailable(): ConflictException {
  return new ConflictException({
    code: 'ACTIVATION_CLAIM_NOT_AVAILABLE',
    message: 'The activation request is not available to claim.',
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

function idempotencyConflict(): ConflictException {
  return new ConflictException({
    code: 'IDEMPOTENCY_KEY_REUSED',
    message: 'Idempotency-Key was already used with a different request.',
    details: {},
  });
}

@Injectable()
export class ActivationClaimService {
  private readonly recoveryTtlMs: number;
  private readonly idleTimeoutMs: number;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    let ttlSeconds = 120;
    let idleMinutes = 30;
    try {
      const environment = loadEnvironment();
      ttlSeconds = environment.GUEST_CLAIM_RECOVERY_TTL_SECONDS;
      idleMinutes = environment.GUEST_IDLE_TIMEOUT_MINUTES;
    } catch {
      // Unit tests can construct the service without a complete process environment.
    }
    this.recoveryTtlMs = ttlSeconds * 1_000;
    this.idleTimeoutMs = idleMinutes * 60 * 1_000;
  }

  async claim(input: ClaimActivationInput, now = new Date()): Promise<ClaimActivationResult> {
    const rawTokenHash = hashToken(input.rawSessionToken);
    const candidate = await this.prisma.guestSession.findFirst({
      where: {
        OR: [{ tokenHash: rawTokenHash }, { previousTokenHash: rawTokenHash }],
      },
      select: { id: true },
    });
    if (!candidate) throw invalidGuestSession();

    const activationCandidate = await this.prisma.activationRequest.findFirst({
      where: { requesterGuestSessionId: candidate.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!activationCandidate) throw claimNotAllowed();

    return this.prisma.$transaction(async (transaction) => {
      const activations = await transaction.$queryRaw<LockedActivation[]>`
        SELECT
          "id",
          "restaurant_id" AS "restaurantId",
          "location_id" AS "locationId",
          "table_id" AS "tableId",
          "requester_guest_session_id" AS "requesterGuestSessionId",
          "status",
          "version"
        FROM "activation_request"
        WHERE "id" = ${activationCandidate.id}::uuid
        FOR UPDATE
      `;
      const activation = activations[0];
      if (!activation || activation.requesterGuestSessionId !== candidate.id) {
        throw claimNotAllowed();
      }

      const tableSessions = await transaction.$queryRaw<LockedTableSession[]>`
        SELECT "id", "status"
        FROM "table_session"
        WHERE "activation_request_id" = ${activation.id}::uuid
          AND "restaurant_id" = ${activation.restaurantId}::uuid
          AND "location_id" = ${activation.locationId}::uuid
          AND "table_id" = ${activation.tableId}::uuid
        FOR UPDATE
      `;
      const tableSession = tableSessions[0];

      const guestSessions = await transaction.$queryRaw<LockedGuestSession[]>`
        SELECT
          gs."id",
          gs."restaurant_id" AS "restaurantId",
          gs."location_id" AS "locationId",
          gs."table_id" AS "tableId",
          gs."table_session_id" AS "tableSessionId",
          gs."token_hash" AS "tokenHash",
          gs."csrf_token_hash" AS "csrfTokenHash",
          gs."previous_token_hash" AS "previousTokenHash",
          gs."previous_csrf_token_hash" AS "previousCsrfTokenHash",
          gs."previous_token_valid_until" AS "previousTokenValidUntil",
          gs."access_level" AS "accessLevel",
          gs."idle_expires_at" AS "idleExpiresAt",
          gs."absolute_expires_at" AS "absoluteExpiresAt",
          gs."revoked_at" AS "revokedAt",
          gs."version",
          rt."is_active" AS "tableActive",
          l."is_active" AS "locationActive",
          (r."status" = 'ACTIVE') AS "restaurantActive"
        FROM "guest_session" gs
        JOIN "restaurant_table" rt
          ON rt."id" = gs."table_id"
          AND rt."restaurant_id" = gs."restaurant_id"
          AND rt."location_id" = gs."location_id"
        JOIN "location" l
          ON l."id" = gs."location_id" AND l."restaurant_id" = gs."restaurant_id"
        JOIN "restaurant" r ON r."id" = gs."restaurant_id"
        WHERE gs."id" = ${candidate.id}::uuid
        FOR UPDATE OF gs
      `;
      const guest = guestSessions[0];
      if (!guest) throw invalidGuestSession();
      this.assertGuestScopeAndLifetime(guest, activation, now);

      const currentCredential = tokensMatch(input.rawSessionToken, guest.tokenHash);
      const previousCredential =
        guest.previousTokenHash !== null &&
        guest.previousTokenValidUntil !== null &&
        guest.previousTokenValidUntil.getTime() > now.getTime() &&
        tokensMatch(input.rawSessionToken, guest.previousTokenHash);
      if (!currentCredential && !previousCredential) throw invalidGuestSession();

      const expectedCsrfHash = currentCredential
        ? guest.csrfTokenHash
        : guest.previousCsrfTokenHash;
      if (!expectedCsrfHash || !tokensMatch(input.rawCsrfToken, expectedCsrfHash)) {
        throw invalidCsrf();
      }

      const requestHash = requestFingerprint(input.expectedVersion);
      const replay = await transaction.idempotencyRecord.findUnique({
        where: {
          actorType_actorId_operation_idempotencyKey: {
            actorType: IdempotencyActorType.GUEST_SESSION,
            actorId: guest.id,
            operation: CLAIM_ACTIVATION_OPERATION,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (replay) {
        if (replay.requestHash !== requestHash || replay.resourceId !== activation.id) {
          throw idempotencyConflict();
        }
        if (
          activation.status !== ActivationRequestStatus.APPROVED ||
          tableSession?.status !== TableSessionStatus.ACTIVE ||
          guest.accessLevel !== GuestAccessLevel.ORDER_ENABLED ||
          guest.tableSessionId !== tableSession?.id
        ) {
          throw claimNotAvailable();
        }
        if (previousCredential) {
          return this.recoverCredentials(transaction, guest, replay.responseBody, now);
        }
        return {
          data: replay.responseBody as ClaimActivationData,
          sessionToken: input.rawSessionToken,
          csrfToken: input.rawCsrfToken,
          absoluteExpiresAt: guest.absoluteExpiresAt,
        };
      }

      if (previousCredential) throw invalidGuestSession();
      if (activation.version !== input.expectedVersion) throw versionConflict();
      if (
        activation.status !== ActivationRequestStatus.APPROVED ||
        !tableSession ||
        tableSession.status !== TableSessionStatus.ACTIVE ||
        guest.accessLevel !== GuestAccessLevel.BROWSE_ONLY ||
        guest.tableSessionId !== null
      ) {
        throw claimNotAvailable();
      }

      const sessionToken = generateOpaqueToken();
      const csrfToken = generateOpaqueToken();
      const updatedGuest = await transaction.guestSession.update({
        where: { id: guest.id },
        data: {
          tableSessionId: tableSession.id,
          accessLevel: GuestAccessLevel.ORDER_ENABLED,
          tokenHash: hashToken(sessionToken),
          csrfTokenHash: hashToken(csrfToken),
          previousTokenHash: guest.tokenHash,
          previousCsrfTokenHash: guest.csrfTokenHash,
          previousTokenValidUntil: new Date(now.getTime() + this.recoveryTtlMs),
          idleExpiresAt: this.nextIdleExpiry(now, guest.absoluteExpiresAt),
          lastSeenAt: now,
          version: { increment: 1 },
        },
        select: { tableSessionId: true, accessLevel: true, version: true },
      });
      const data: ClaimActivationData = {
        session: {
          accessLevel: 'ORDER_ENABLED',
          tableSessionId: updatedGuest.tableSessionId!,
          version: updatedGuest.version,
        },
      };

      await transaction.auditLog.create({
        data: {
          restaurantId: activation.restaurantId,
          locationId: activation.locationId,
          actorType: AuditActorType.GUEST_SESSION,
          actorId: guest.id,
          action: 'GUEST_ACTIVATION_CLAIMED',
          resourceType: 'ActivationRequest',
          resourceId: activation.id,
          metadata: {
            tableId: activation.tableId,
            tableSessionId: tableSession.id,
            guestSessionVersionBefore: guest.version,
            guestSessionVersionAfter: updatedGuest.version,
          },
        },
      });
      await transaction.idempotencyRecord.create({
        data: {
          restaurantId: activation.restaurantId,
          actorType: IdempotencyActorType.GUEST_SESSION,
          actorId: guest.id,
          operation: CLAIM_ACTIVATION_OPERATION,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          status: IdempotencyRecordStatus.COMPLETED,
          responseStatus: 200,
          responseBody: data,
          resourceId: activation.id,
          expiresAt: guest.absoluteExpiresAt,
        },
      });

      return { data, sessionToken, csrfToken, absoluteExpiresAt: guest.absoluteExpiresAt };
    });
  }

  private assertGuestScopeAndLifetime(
    guest: LockedGuestSession,
    activation: LockedActivation,
    now: Date,
  ): void {
    if (
      guest.id !== activation.requesterGuestSessionId ||
      guest.restaurantId !== activation.restaurantId ||
      guest.locationId !== activation.locationId ||
      guest.tableId !== activation.tableId
    ) {
      throw claimNotAllowed();
    }
    if (
      guest.revokedAt !== null ||
      !guest.tableActive ||
      !guest.locationActive ||
      !guest.restaurantActive ||
      guest.idleExpiresAt.getTime() <= now.getTime() ||
      guest.absoluteExpiresAt.getTime() <= now.getTime()
    ) {
      throw invalidGuestSession();
    }
  }

  private async recoverCredentials(
    transaction: Prisma.TransactionClient,
    guest: LockedGuestSession,
    responseBody: unknown,
    now: Date,
  ): Promise<ClaimActivationResult> {
    const sessionToken = generateOpaqueToken();
    const csrfToken = generateOpaqueToken();
    await transaction.guestSession.update({
      where: { id: guest.id },
      data: {
        tokenHash: hashToken(sessionToken),
        csrfTokenHash: hashToken(csrfToken),
        idleExpiresAt: this.nextIdleExpiry(now, guest.absoluteExpiresAt),
        lastSeenAt: now,
      },
    });
    return {
      data: responseBody as ClaimActivationData,
      sessionToken,
      csrfToken,
      absoluteExpiresAt: guest.absoluteExpiresAt,
    };
  }

  private nextIdleExpiry(now: Date, absoluteExpiresAt: Date): Date {
    return new Date(Math.min(now.getTime() + this.idleTimeoutMs, absoluteExpiresAt.getTime()));
  }
}
