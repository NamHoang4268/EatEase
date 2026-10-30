import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { loadEnvironment } from '../config/environment.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  AuditActorType,
  GuestAccessLevel,
  IdempotencyActorType,
  IdempotencyRecordStatus,
  JoinRateLimitDimension,
  TableSessionStatus,
} from '../generated/prisma/enums.js';
import type { Prisma } from '../generated/prisma/client.js';
import { generateOpaqueToken, hashToken, tokensMatch } from '../staff-auth/auth.crypto.js';
import type { GuestPrincipal } from '../guest-session/guest-session.types.js';
import type {
  HostIssueInput,
  IssueJoinCodeData,
  JoinCodeMetadata,
  JoinTableData,
  JoinTableInput,
  RotatedGuestResult,
  StaffIssueInput,
  StaffRevokeInput,
} from './join-code.types.js';

const HOST_ISSUE_OPERATION = 'HOST_ISSUE_JOIN_CODE';
const STAFF_ISSUE_OPERATION = 'STAFF_ISSUE_JOIN_CODE';
const STAFF_REVOKE_OPERATION = 'STAFF_REVOKE_JOIN_CODE';
const JOIN_OPERATION = 'JOIN_TABLE_SESSION';
const WINDOW_MS = 10 * 60 * 1_000;
const COOLDOWN_MS = 10 * 60 * 1_000;

type LockedTableSession = {
  id: string;
  restaurantId: string;
  locationId: string;
  tableId: string;
  activationRequestId: string;
  status: TableSessionStatus;
  version: number;
};

type LockedJoinCode = { id: string; codeHash: string; expiresAt: Date; revokedAt: Date | null };

type LockedGuest = {
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
};

type RateBucket = {
  id: string;
  dimension: JoinRateLimitDimension;
  subjectHash: string;
  windowStartedAt: Date;
  failedAttempts: number;
  blockedUntil: Date | null;
};

const dimensionLimit: Record<JoinRateLimitDimension, number> = {
  [JoinRateLimitDimension.GUEST_TABLE]: 5,
  [JoinRateLimitDimension.IP_TABLE]: 20,
  [JoinRateLimitDimension.TABLE_SESSION]: 100,
};

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

const invalidGuest = () =>
  new UnauthorizedException({
    code: 'GUEST_SESSION_INVALID',
    message: 'Guest session is invalid or expired.',
    details: {},
  });
const invalidCsrf = () =>
  new ForbiddenException({
    code: 'GUEST_CSRF_INVALID',
    message: 'CSRF validation failed.',
    details: {},
  });
const hostDenied = () =>
  new ForbiddenException({
    code: 'JOIN_CODE_HOST_ACCESS_DENIED',
    message: 'Host access is required.',
    details: {},
  });
const staffDenied = () =>
  new ForbiddenException({
    code: 'STAFF_AUTHORIZATION_DENIED',
    message: 'Authorization denied.',
    details: {},
  });
const invalidCode = () =>
  new ForbiddenException({
    code: 'JOIN_CODE_INVALID',
    message: 'The Join Code is invalid or unavailable.',
    details: {},
  });
const rateLimited = () =>
  new HttpException(
    { code: 'JOIN_ATTEMPT_RATE_LIMITED', message: 'Too many attempts.', details: {} },
    429,
  );
const sessionNotJoinable = () =>
  new ConflictException({
    code: 'TABLE_SESSION_NOT_JOINABLE',
    message: 'The table session is not joinable.',
    details: {},
  });
const versionConflict = () =>
  new ConflictException({
    code: 'TABLE_SESSION_VERSION_CONFLICT',
    message: 'The version is stale.',
    details: {},
  });
const replacementRequired = () =>
  new ConflictException({
    code: 'JOIN_CODE_REPLACEMENT_CONFIRMATION_REQUIRED',
    message: 'Explicit replacement confirmation is required.',
    details: {},
  });
const idempotencyConflict = () =>
  new ConflictException({
    code: 'IDEMPOTENCY_KEY_REUSED',
    message: 'Idempotency-Key payload conflict.',
    details: {},
  });

@Injectable()
export class JoinCodeService {
  private readonly codeTtlMs: number;
  private readonly recoveryTtlMs: number;
  private readonly idleTimeoutMs: number;
  private readonly hashSecret: string;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    let codeTtlMinutes = 30;
    let recoveryTtlSeconds = 120;
    let idleMinutes = 30;
    let hashSecret = 'development-only-join-code-secret-32-chars';
    try {
      const environment = loadEnvironment();
      codeTtlMinutes = environment.JOIN_CODE_TTL_MINUTES;
      recoveryTtlSeconds = environment.JOIN_RECOVERY_TTL_SECONDS;
      idleMinutes = environment.GUEST_IDLE_TIMEOUT_MINUTES;
      hashSecret = environment.JOIN_CODE_HASH_SECRET ?? hashSecret;
    } catch {
      // Unit tests can construct the service without a complete environment.
    }
    this.codeTtlMs = codeTtlMinutes * 60_000;
    this.recoveryTtlMs = recoveryTtlSeconds * 1_000;
    this.idleTimeoutMs = idleMinutes * 60_000;
    this.hashSecret = hashSecret;
  }

  async getHostMetadata(principal: GuestPrincipal, now = new Date()): Promise<JoinCodeMetadata> {
    const host = await this.prisma.guestSession.findFirst({
      where: {
        id: principal.sessionId,
        accessLevel: GuestAccessLevel.ORDER_ENABLED,
        tableSession: {
          status: TableSessionStatus.ACTIVE,
          activationRequest: { requesterGuestSessionId: principal.sessionId },
        },
      },
      select: {
        tableSession: {
          select: {
            version: true,
            joinCodes: {
              where: { revokedAt: null },
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { expiresAt: true },
            },
          },
        },
      },
    });
    if (!host?.tableSession) throw hostDenied();
    const current = host.tableSession.joinCodes[0];
    const active = current && current.expiresAt > now ? current : undefined;
    return {
      hasActiveCode: Boolean(active),
      expiresAt: active?.expiresAt.toISOString() ?? null,
      tableSessionVersion: host.tableSession.version,
    };
  }

  async issueForHost(input: HostIssueInput, now = new Date()): Promise<IssueJoinCodeData> {
    const guest = await this.prisma.guestSession.findUnique({
      where: { id: input.principal.sessionId },
      select: { tableSessionId: true },
    });
    if (!guest?.tableSessionId) throw hostDenied();
    return this.issueCode({
      actorType: IdempotencyActorType.GUEST_SESSION,
      actorId: input.principal.sessionId,
      tableSessionId: guest.tableSessionId,
      expectedVersion: input.expectedVersion,
      replaceExisting: input.replaceExisting,
      idempotencyKey: input.idempotencyKey,
      operation: HOST_ISSUE_OPERATION,
      hostSessionId: input.principal.sessionId,
      now,
    });
  }

  async issueForStaff(input: StaffIssueInput, now = new Date()): Promise<IssueJoinCodeData> {
    return this.issueCode({
      actorType: IdempotencyActorType.STAFF_MEMBERSHIP,
      actorId: input.principal.membershipId,
      tableSessionId: input.tableSessionId,
      expectedVersion: input.expectedVersion,
      replaceExisting: input.replaceExisting,
      idempotencyKey: input.idempotencyKey,
      operation: STAFF_ISSUE_OPERATION,
      staffPrincipal: input.principal,
      now,
    });
  }

  async listActiveForStaff(principal: StaffIssueInput['principal'], now = new Date()) {
    const sessions = await this.prisma.tableSession.findMany({
      where: {
        restaurantId: principal.restaurantId,
        locationId: principal.locationId,
        status: TableSessionStatus.ACTIVE,
      },
      orderBy: { activatedAt: 'asc' },
      select: {
        id: true,
        version: true,
        activatedAt: true,
        table: { select: { publicId: true, code: true, capacity: true } },
        joinCodes: {
          where: { revokedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { expiresAt: true },
        },
      },
    });
    return sessions.map(({ joinCodes, activatedAt, ...session }) => {
      const current = joinCodes[0];
      const active = current && current.expiresAt > now ? current : undefined;
      return {
        ...session,
        activatedAt: activatedAt.toISOString(),
        joinCode: {
          hasActiveCode: Boolean(active),
          expiresAt: active?.expiresAt.toISOString() ?? null,
        },
      };
    });
  }

  async revokeForStaff(input: StaffRevokeInput, now = new Date()): Promise<JoinCodeMetadata> {
    const requestHash = fingerprint({ id: input.tableSessionId, version: input.expectedVersion });
    return this.prisma.$transaction(async (transaction) => {
      const session = await this.lockTableSession(transaction, input.tableSessionId);
      if (
        !session ||
        session.restaurantId !== input.principal.restaurantId ||
        session.locationId !== input.principal.locationId
      )
        throw staffDenied();
      const current = await this.lockCurrentCode(transaction, session.id);
      const actorExpiry = await this.revalidateStaff(
        transaction,
        input.principal,
        'table.join_code.manage',
      );
      const replay = await this.findReplay(
        transaction,
        IdempotencyActorType.STAFF_MEMBERSHIP,
        input.principal.membershipId,
        STAFF_REVOKE_OPERATION,
        input.idempotencyKey,
      );
      if (replay) {
        this.assertReplay(replay, requestHash, session.id);
        return replay.responseBody as JoinCodeMetadata;
      }
      if (session.status !== TableSessionStatus.ACTIVE) throw sessionNotJoinable();
      if (session.version !== input.expectedVersion) throw versionConflict();
      if (current) {
        await transaction.sessionJoinCode.update({
          where: { id: current.id },
          data: { revokedAt: now },
        });
      }
      const updated = await transaction.tableSession.update({
        where: { id: session.id },
        data: { version: { increment: 1 } },
        select: { version: true },
      });
      const data: JoinCodeMetadata = {
        hasActiveCode: false,
        expiresAt: null,
        tableSessionVersion: updated.version,
      };
      await this.persistReliability(transaction, {
        session,
        actorType: IdempotencyActorType.STAFF_MEMBERSHIP,
        actorId: input.principal.membershipId,
        auditActorType: AuditActorType.STAFF_MEMBERSHIP,
        operation: STAFF_REVOKE_OPERATION,
        action: 'JOIN_CODE_REVOKED',
        idempotencyKey: input.idempotencyKey,
        requestHash,
        data,
        actorExpiry,
        versionAfter: updated.version,
        now,
      });
      return data;
    });
  }

  async join(input: JoinTableInput, now = new Date()): Promise<RotatedGuestResult> {
    const candidate = await this.prisma.guestSession.findFirst({
      where: {
        OR: [
          { tokenHash: hashToken(input.rawSessionToken) },
          { previousTokenHash: hashToken(input.rawSessionToken) },
        ],
      },
      select: { id: true, tableId: true },
    });
    if (!candidate) throw invalidGuest();
    const target = await this.prisma.tableSession.findFirst({
      where: { tableId: candidate.tableId, status: TableSessionStatus.ACTIVE },
      select: { id: true },
    });
    if (!target) throw sessionNotJoinable();

    const outcome = await this.prisma.$transaction(async (transaction) => {
      const session = await this.lockTableSession(transaction, target.id);
      if (!session || session.status !== TableSessionStatus.ACTIVE) throw sessionNotJoinable();
      const currentCode = await this.lockCurrentCode(transaction, session.id);
      const guest = await this.lockGuest(transaction, candidate.id);
      if (!guest) throw invalidGuest();
      this.assertGuestLifetime(guest, now);
      if (guest.tableId !== session.tableId) throw invalidCode();

      const currentCredential = tokensMatch(input.rawSessionToken, guest.tokenHash);
      const previousCredential =
        guest.previousTokenHash !== null &&
        guest.previousTokenValidUntil !== null &&
        guest.previousTokenValidUntil > now &&
        tokensMatch(input.rawSessionToken, guest.previousTokenHash);
      if (!currentCredential && !previousCredential) throw invalidGuest();
      const expectedCsrf = currentCredential ? guest.csrfTokenHash : guest.previousCsrfTokenHash;
      if (!expectedCsrf || !tokensMatch(input.rawCsrfToken, expectedCsrf)) throw invalidCsrf();

      const requestHash = fingerprint({
        tablePublicId: input.tablePublicId,
        joinCodeHash: this.secureFingerprint(input.joinCode),
      });
      const replay = await this.findReplay(
        transaction,
        IdempotencyActorType.GUEST_SESSION,
        guest.id,
        JOIN_OPERATION,
        input.idempotencyKey,
      );
      if (replay) {
        this.assertReplay(replay, requestHash, session.id);
        if (
          guest.accessLevel !== GuestAccessLevel.ORDER_ENABLED ||
          guest.tableSessionId !== session.id
        ) {
          throw sessionNotJoinable();
        }
        if (previousCredential) {
          return {
            kind: 'success',
            result: await this.recoverJoinCredentials(transaction, guest, replay.responseBody, now),
          } as const;
        }
        return {
          kind: 'success',
          result: {
            data: replay.responseBody as JoinTableData,
            sessionToken: input.rawSessionToken,
            csrfToken: input.rawCsrfToken,
            absoluteExpiresAt: guest.absoluteExpiresAt,
          },
        } as const;
      }
      if (previousCredential) throw invalidGuest();
      if (guest.accessLevel !== GuestAccessLevel.BROWSE_ONLY || guest.tableSessionId !== null) {
        throw sessionNotJoinable();
      }
      const tableMatches = await transaction.restaurantTable.count({
        where: { id: session.tableId, publicId: input.tablePublicId },
      });
      if (tableMatches !== 1) throw invalidCode();

      const buckets = await this.lockRateBuckets(
        transaction,
        session,
        guest.id,
        input.sourceIp,
        now,
      );
      if (buckets.some((bucket) => bucket.blockedUntil && bucket.blockedUntil > now)) {
        return { kind: 'rate-limited' } as const;
      }
      const validCode =
        currentCode !== undefined &&
        currentCode.expiresAt > now &&
        this.joinCodeMatches(input.joinCode, currentCode.codeHash);
      if (!validCode) {
        const blocked = await this.recordFailedAttempt(transaction, buckets, now);
        return blocked ? ({ kind: 'rate-limited' } as const) : ({ kind: 'invalid' } as const);
      }

      const sessionToken = generateOpaqueToken();
      const csrfToken = generateOpaqueToken();
      const updatedGuest = await transaction.guestSession.update({
        where: { id: guest.id },
        data: {
          tableSessionId: session.id,
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
        select: { version: true },
      });
      const data: JoinTableData = {
        session: {
          accessLevel: 'ORDER_ENABLED',
          tableSessionId: session.id,
          version: updatedGuest.version,
        },
      };
      await transaction.auditLog.create({
        data: {
          restaurantId: session.restaurantId,
          locationId: session.locationId,
          actorType: AuditActorType.GUEST_SESSION,
          actorId: guest.id,
          action: 'GUEST_JOINED_TABLE_SESSION',
          resourceType: 'TableSession',
          resourceId: session.id,
          metadata: { tableId: session.tableId, guestSessionVersionAfter: updatedGuest.version },
        },
      });
      await transaction.idempotencyRecord.create({
        data: {
          restaurantId: session.restaurantId,
          actorType: IdempotencyActorType.GUEST_SESSION,
          actorId: guest.id,
          operation: JOIN_OPERATION,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          status: IdempotencyRecordStatus.COMPLETED,
          responseStatus: 200,
          responseBody: data,
          resourceId: session.id,
          expiresAt: guest.absoluteExpiresAt,
        },
      });
      return {
        kind: 'success',
        result: { data, sessionToken, csrfToken, absoluteExpiresAt: guest.absoluteExpiresAt },
      } as const;
    });
    if (outcome.kind === 'invalid') throw invalidCode();
    if (outcome.kind === 'rate-limited') throw rateLimited();
    return outcome.result;
  }

  private async issueCode(input: {
    actorType: IdempotencyActorType;
    actorId: string;
    tableSessionId: string;
    expectedVersion: number;
    replaceExisting: boolean;
    idempotencyKey: string;
    operation: string;
    hostSessionId?: string;
    staffPrincipal?: StaffIssueInput['principal'];
    now: Date;
  }): Promise<IssueJoinCodeData> {
    const requestHash = fingerprint({
      id: input.tableSessionId,
      version: input.expectedVersion,
      replace: input.replaceExisting,
    });
    return this.prisma.$transaction(async (transaction) => {
      const session = await this.lockTableSession(transaction, input.tableSessionId);
      if (!session) throw input.hostSessionId ? hostDenied() : staffDenied();
      const current = await this.lockCurrentCode(transaction, session.id);
      let actorExpiry: Date;
      if (input.hostSessionId) {
        const host = await this.lockGuest(transaction, input.hostSessionId);
        const activation = await transaction.activationRequest.findUnique({
          where: { id: session.activationRequestId },
          select: { requesterGuestSessionId: true },
        });
        if (
          !host ||
          host.tableSessionId !== session.id ||
          host.accessLevel !== GuestAccessLevel.ORDER_ENABLED ||
          host.revokedAt !== null ||
          host.idleExpiresAt <= input.now ||
          host.absoluteExpiresAt <= input.now ||
          activation?.requesterGuestSessionId !== host.id
        )
          throw hostDenied();
        actorExpiry = host.absoluteExpiresAt;
      } else if (input.staffPrincipal) {
        if (
          session.restaurantId !== input.staffPrincipal.restaurantId ||
          session.locationId !== input.staffPrincipal.locationId
        )
          throw staffDenied();
        actorExpiry = await this.revalidateStaff(
          transaction,
          input.staffPrincipal,
          'table.join_code.manage',
        );
      } else {
        throw staffDenied();
      }

      const replay = await this.findReplay(
        transaction,
        input.actorType,
        input.actorId,
        input.operation,
        input.idempotencyKey,
      );
      if (replay) {
        this.assertReplay(replay, requestHash, session.id);
        return {
          ...(replay.responseBody as IssueJoinCodeData),
          code: null,
          plaintextAvailable: false,
        };
      }
      if (session.status !== TableSessionStatus.ACTIVE) throw sessionNotJoinable();
      if (session.version !== input.expectedVersion) throw versionConflict();
      if (current && current.expiresAt > input.now && !input.replaceExisting) {
        throw replacementRequired();
      }
      if (current) {
        await transaction.sessionJoinCode.update({
          where: { id: current.id },
          data: { revokedAt: input.now },
        });
      }

      const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
      const expiresAt = new Date(input.now.getTime() + this.codeTtlMs);
      await transaction.sessionJoinCode.create({
        data: {
          restaurantId: session.restaurantId,
          locationId: session.locationId,
          tableId: session.tableId,
          tableSessionId: session.id,
          codeHash: this.secureFingerprint(code),
          expiresAt,
          createdByGuestSessionId: input.hostSessionId ?? null,
          createdByMembershipId: input.staffPrincipal?.membershipId ?? null,
          createdAt: input.now,
        },
      });
      const updated = await transaction.tableSession.update({
        where: { id: session.id },
        data: { version: { increment: 1 } },
        select: { version: true },
      });
      const data: IssueJoinCodeData = {
        code,
        plaintextAvailable: true,
        hasActiveCode: true,
        expiresAt: expiresAt.toISOString(),
        tableSessionVersion: updated.version,
      };
      await this.persistReliability(transaction, {
        session,
        actorType: input.actorType,
        actorId: input.actorId,
        auditActorType: input.hostSessionId
          ? AuditActorType.GUEST_SESSION
          : AuditActorType.STAFF_MEMBERSHIP,
        operation: input.operation,
        action: current ? 'JOIN_CODE_ROTATED' : 'JOIN_CODE_ISSUED',
        idempotencyKey: input.idempotencyKey,
        requestHash,
        data: { ...data, code: null, plaintextAvailable: false },
        actorExpiry,
        versionAfter: updated.version,
        now: input.now,
      });
      return data;
    });
  }

  private async persistReliability(
    transaction: Prisma.TransactionClient,
    input: {
      session: LockedTableSession;
      actorType: IdempotencyActorType;
      actorId: string;
      auditActorType: AuditActorType;
      operation: string;
      action: string;
      idempotencyKey: string;
      requestHash: string;
      data: IssueJoinCodeData | JoinCodeMetadata;
      actorExpiry: Date;
      versionAfter: number;
      now: Date;
    },
  ): Promise<void> {
    await transaction.auditLog.create({
      data: {
        restaurantId: input.session.restaurantId,
        locationId: input.session.locationId,
        actorType: input.auditActorType,
        actorId: input.actorId,
        action: input.action,
        resourceType: 'TableSession',
        resourceId: input.session.id,
        metadata: {
          tableId: input.session.tableId,
          tableSessionVersionBefore: input.session.version,
          tableSessionVersionAfter: input.versionAfter,
        },
      },
    });
    await transaction.outboxEvent.create({
      data: {
        restaurantId: input.session.restaurantId,
        locationId: input.session.locationId,
        aggregateType: 'TableSession',
        aggregateId: input.session.id,
        eventType: 'table.session.updated',
        payload: {
          id: input.session.id,
          tableId: input.session.tableId,
          version: input.versionAfter,
          change: input.action,
          occurredAt: input.now.toISOString(),
        },
        occurredAt: input.now,
      },
    });
    await transaction.idempotencyRecord.create({
      data: {
        restaurantId: input.session.restaurantId,
        actorType: input.actorType,
        actorId: input.actorId,
        operation: input.operation,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        status: IdempotencyRecordStatus.COMPLETED,
        responseStatus: 200,
        responseBody: input.data,
        resourceId: input.session.id,
        expiresAt: input.actorExpiry,
      },
    });
  }

  private async lockTableSession(transaction: Prisma.TransactionClient, id: string) {
    const rows = await transaction.$queryRaw<LockedTableSession[]>`
      SELECT "id", "restaurant_id" AS "restaurantId", "location_id" AS "locationId",
        "table_id" AS "tableId", "activation_request_id" AS "activationRequestId",
        "status", "version"
      FROM "table_session" WHERE "id" = ${id}::uuid FOR UPDATE
    `;
    return rows[0];
  }

  private async lockCurrentCode(transaction: Prisma.TransactionClient, tableSessionId: string) {
    const rows = await transaction.$queryRaw<LockedJoinCode[]>`
      SELECT "id", "code_hash" AS "codeHash", "expires_at" AS "expiresAt",
        "revoked_at" AS "revokedAt"
      FROM "session_join_code"
      WHERE "table_session_id" = ${tableSessionId}::uuid AND "revoked_at" IS NULL
      ORDER BY "created_at" DESC LIMIT 1 FOR UPDATE
    `;
    return rows[0];
  }

  private async lockGuest(transaction: Prisma.TransactionClient, id: string) {
    const rows = await transaction.$queryRaw<LockedGuest[]>`
      SELECT "id", "restaurant_id" AS "restaurantId", "location_id" AS "locationId",
        "table_id" AS "tableId", "table_session_id" AS "tableSessionId",
        "token_hash" AS "tokenHash", "csrf_token_hash" AS "csrfTokenHash",
        "previous_token_hash" AS "previousTokenHash",
        "previous_csrf_token_hash" AS "previousCsrfTokenHash",
        "previous_token_valid_until" AS "previousTokenValidUntil",
        "access_level" AS "accessLevel", "idle_expires_at" AS "idleExpiresAt",
        "absolute_expires_at" AS "absoluteExpiresAt", "revoked_at" AS "revokedAt", "version"
      FROM "guest_session" WHERE "id" = ${id}::uuid FOR UPDATE
    `;
    return rows[0];
  }

  private async lockRateBuckets(
    transaction: Prisma.TransactionClient,
    session: LockedTableSession,
    guestId: string,
    sourceIp: string,
    now: Date,
  ): Promise<RateBucket[]> {
    const subjects = [
      [
        JoinRateLimitDimension.GUEST_TABLE,
        this.secureFingerprint({ guestId, tableId: session.tableId }),
      ],
      [
        JoinRateLimitDimension.IP_TABLE,
        this.secureFingerprint({ sourceIp, tableId: session.tableId }),
      ],
      [
        JoinRateLimitDimension.TABLE_SESSION,
        this.secureFingerprint({ tableSessionId: session.id }),
      ],
    ] as const;
    await transaction.joinAttemptRateLimit.createMany({
      data: subjects.map(([dimension, subjectHash]) => ({
        restaurantId: session.restaurantId,
        locationId: session.locationId,
        tableId: session.tableId,
        tableSessionId: session.id,
        dimension,
        subjectHash,
        windowStartedAt: now,
        updatedAt: now,
      })),
      skipDuplicates: true,
    });
    const rows = await transaction.$queryRaw<RateBucket[]>`
      SELECT "id", "dimension", "subject_hash" AS "subjectHash",
        "window_started_at" AS "windowStartedAt", "failed_attempts" AS "failedAttempts",
        "blocked_until" AS "blockedUntil"
      FROM "join_attempt_rate_limit"
      WHERE "table_session_id" = ${session.id}::uuid
      ORDER BY "dimension", "subject_hash" FOR UPDATE
    `;
    const wanted = new Set(subjects.map(([, subjectHash]) => subjectHash));
    const buckets = rows.filter((row) => wanted.has(row.subjectHash));
    for (const bucket of buckets) {
      if (
        bucket.windowStartedAt.getTime() + WINDOW_MS <= now.getTime() &&
        (!bucket.blockedUntil || bucket.blockedUntil <= now)
      ) {
        await transaction.joinAttemptRateLimit.update({
          where: { id: bucket.id },
          data: { windowStartedAt: now, failedAttempts: 0, blockedUntil: null, updatedAt: now },
        });
        bucket.windowStartedAt = now;
        bucket.failedAttempts = 0;
        bucket.blockedUntil = null;
      }
    }
    return buckets;
  }

  private async recordFailedAttempt(
    transaction: Prisma.TransactionClient,
    buckets: RateBucket[],
    now: Date,
  ): Promise<boolean> {
    let blocked = false;
    for (const bucket of buckets) {
      const failedAttempts = bucket.failedAttempts + 1;
      const reachesLimit = failedAttempts >= dimensionLimit[bucket.dimension];
      await transaction.joinAttemptRateLimit.update({
        where: { id: bucket.id },
        data: {
          failedAttempts,
          blockedUntil: reachesLimit ? new Date(now.getTime() + COOLDOWN_MS) : null,
          updatedAt: now,
        },
      });
      blocked ||= reachesLimit;
    }
    return blocked;
  }

  private findReplay(
    transaction: Prisma.TransactionClient,
    actorType: IdempotencyActorType,
    actorId: string,
    operation: string,
    idempotencyKey: string,
  ) {
    return transaction.idempotencyRecord.findUnique({
      where: {
        actorType_actorId_operation_idempotencyKey: {
          actorType,
          actorId,
          operation,
          idempotencyKey,
        },
      },
    });
  }

  private assertReplay(
    replay: { requestHash: string; resourceId: string | null },
    requestHash: string,
    resourceId: string,
  ): void {
    if (replay.requestHash !== requestHash || replay.resourceId !== resourceId) {
      throw idempotencyConflict();
    }
  }

  private assertGuestLifetime(guest: LockedGuest, now: Date): void {
    if (guest.revokedAt !== null || guest.idleExpiresAt <= now || guest.absoluteExpiresAt <= now)
      throw invalidGuest();
  }

  private async recoverJoinCredentials(
    transaction: Prisma.TransactionClient,
    guest: LockedGuest,
    responseBody: Prisma.JsonValue,
    now: Date,
  ): Promise<RotatedGuestResult> {
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
      data: responseBody as JoinTableData,
      sessionToken,
      csrfToken,
      absoluteExpiresAt: guest.absoluteExpiresAt,
    };
  }

  private nextIdleExpiry(now: Date, absoluteExpiry: Date): Date {
    return new Date(Math.min(now.getTime() + this.idleTimeoutMs, absoluteExpiry.getTime()));
  }

  private secureFingerprint(value: unknown): string {
    return createHmac('sha256', this.hashSecret).update(JSON.stringify(value)).digest('hex');
  }

  private joinCodeMatches(code: string, expectedHash: string): boolean {
    const actual = Buffer.from(this.secureFingerprint(code), 'hex');
    const expected = Buffer.from(expectedHash, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  private async revalidateStaff(
    transaction: Prisma.TransactionClient,
    principal: StaffIssueInput['principal'],
    permission: string,
  ): Promise<Date> {
    const rows = await transaction.$queryRaw<Array<{ expiresAt: Date; allowed: boolean }>>`
      SELECT ss."expires_at" AS "expiresAt",
        EXISTS (
          SELECT 1 FROM "membership_role" mr
          JOIN "role_permission" rp ON rp."role_id" = mr."role_id"
          JOIN "permission" p ON p."id" = rp."permission_id"
          WHERE mr."membership_id" = sm."id" AND mr."restaurant_id" = sm."restaurant_id"
            AND p."code" = ${permission}
        ) AS "allowed"
      FROM "staff_session" ss
      JOIN "staff_user" su ON su."id" = ss."staff_user_id"
      JOIN "staff_membership" sm ON sm."id" = ss."membership_id"
        AND sm."staff_user_id" = ss."staff_user_id"
      JOIN "location" l ON l."id" = sm."location_id" AND l."restaurant_id" = sm."restaurant_id"
      JOIN "restaurant" r ON r."id" = sm."restaurant_id"
      WHERE ss."id" = ${principal.sessionId}::uuid
        AND sm."id" = ${principal.membershipId}::uuid
        AND sm."restaurant_id" = ${principal.restaurantId}::uuid
        AND sm."location_id" = ${principal.locationId}::uuid
        AND ss."revoked_at" IS NULL AND ss."expires_at" > clock_timestamp()
        AND su."status" = 'ACTIVE' AND sm."status" = 'ACTIVE'
        AND l."is_active" = true AND r."status" = 'ACTIVE'
      FOR SHARE OF ss, su, sm, l, r
    `;
    if (!rows[0]?.allowed) throw staffDenied();
    return rows[0].expiresAt;
  }
}
