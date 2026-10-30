import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module.js';
import { FoundationExceptionFilter } from '../common/filters/foundation-exception.filter.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  ActivationRequestStatus,
  GuestAccessLevel,
  RestaurantStatus,
  TablePhysicalStatus,
} from '../generated/prisma/enums.js';
import { GUEST_SESSION_COOKIE } from '../guest-session/guest-session.constants.js';
import { hashToken } from '../staff-auth/auth.crypto.js';
import { JOIN_CODE_TTL_MS, JOIN_RECOVERY_TTL_MS } from './join-code.constants.js';
import {
  createProxySignature,
  TRUSTED_CLIENT_IP_HEADER,
  TRUSTED_PROXY_SIGNATURE_HEADER,
  TRUSTED_PROXY_TIMESTAMP_HEADER,
} from './join-source-ip.service.js';
import type { JoinTableData } from './join-code.types.js';

const databaseUrlValue = process.env.DATABASE_URL;
if (!databaseUrlValue) throw new Error('DATABASE_URL is required for Join Code tests.');
const databaseUrl = new URL(databaseUrlValue);
const databaseName = databaseUrl.pathname.replace(/^\//, '');
if (
  !['localhost', '127.0.0.1', '::1'].includes(databaseUrl.hostname) ||
  (databaseName !== 'eatease_m2_test' && process.env.CI !== 'true')
)
  throw new Error('Join Code tests require isolated local eatease_m2_test or ephemeral CI.');

process.env.NODE_ENV = 'test';
process.env.TRUSTED_WEB_ORIGINS = 'http://localhost:3000';
process.env.JOIN_CODE_HASH_SECRET = 'm2-7-test-join-code-secret-at-least-32-characters';
process.env.API_PROXY_SHARED_SECRET = 'm2-7-test-api-proxy-secret-at-least-32-characters';

const joinFingerprint = (value: unknown) =>
  createHmac('sha256', process.env.JOIN_CODE_HASH_SECRET!)
    .update(JSON.stringify(value))
    .digest('hex');

const ids = {
  restaurant: 'd1000000-0000-4000-8000-000000000001',
  location: 'd2000000-0000-4000-8000-000000000001',
  table: 'd3000000-0000-4000-8000-000000000001',
  tablePublic: 'd3100000-0000-4000-8000-000000000001',
  staff: 'd4000000-0000-4000-8000-000000000001',
  membership: 'd5000000-0000-4000-8000-000000000001',
  host: 'd6000000-0000-4000-8000-000000000001',
  member: 'd6000000-0000-4000-8000-000000000002',
  memberTwo: 'd6000000-0000-4000-8000-000000000003',
} as const;

const tokens = {
  host: 'm2-7-host-token',
  hostCsrf: 'm2-7-host-csrf',
  member: 'm2-7-member-token',
  memberCsrf: 'm2-7-member-csrf',
  memberTwo: 'm2-7-member-two-token',
  memberTwoCsrf: 'm2-7-member-two-csrf',
};

describe('M2.7 Join Code lifecycle database integration', () => {
  let application: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let tableSessionId: string;

  const cookie = (token: string) => `${GUEST_SESSION_COOKIE}=${encodeURIComponent(token)}`;

  const hostIssue = (expectedVersion: number, replaceExisting: boolean, key: string) =>
    request(server)
      .post('/api/v1/table-sessions/current/join-code')
      .set('Cookie', cookie(tokens.host))
      .set('Origin', 'http://localhost:3000')
      .set('X-CSRF-Token', tokens.hostCsrf)
      .set('Idempotency-Key', key)
      .send({ expectedVersion, replaceExisting });

  const join = (
    token: string,
    csrf: string,
    code: string,
    key: string,
    sourceIp = '127.0.0.1',
    forwardedFor = sourceIp,
  ) => {
    const timestamp = String(Date.now());
    const signature = createProxySignature(process.env.API_PROXY_SHARED_SECRET!, {
      clientIp: sourceIp,
      method: 'POST',
      pathname: '/api/v1/table-sessions/join',
      timestamp,
    });
    return request(server)
      .post('/api/v1/table-sessions/join')
      .set('Cookie', cookie(token))
      .set('Origin', 'http://localhost:3000')
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', key)
      .set('X-Forwarded-For', forwardedFor)
      .set(TRUSTED_CLIENT_IP_HEADER, sourceIp)
      .set(TRUSTED_PROXY_TIMESTAMP_HEADER, timestamp)
      .set(TRUSTED_PROXY_SIGNATURE_HEADER, signature)
      .send({ tablePublicId: ids.tablePublic, joinCode: code });
  };

  async function cleanup(): Promise<void> {
    await prisma.joinAttemptRateLimit.deleteMany({ where: { restaurantId: ids.restaurant } });
    await prisma.sessionJoinCode.deleteMany({ where: { restaurantId: ids.restaurant } });
    await prisma.idempotencyRecord.deleteMany({ where: { restaurantId: ids.restaurant } });
    await prisma.auditLog.deleteMany({ where: { restaurantId: ids.restaurant } });
    await prisma.outboxEvent.deleteMany({ where: { restaurantId: ids.restaurant } });
    await prisma.bill.deleteMany({ where: { restaurantId: ids.restaurant } });
    await prisma.guestSession.updateMany({
      where: { id: { in: [ids.host, ids.member, ids.memberTwo] } },
      data: {
        tableSessionId: null,
        accessLevel: GuestAccessLevel.BROWSE_ONLY,
        previousTokenHash: null,
        previousCsrfTokenHash: null,
        previousTokenValidUntil: null,
        version: 0,
      },
    });
    await prisma.tableSession.deleteMany({ where: { restaurantId: ids.restaurant } });
    await prisma.activationRequest.deleteMany({ where: { restaurantId: ids.restaurant } });
  }

  async function resetCredentials(): Promise<void> {
    const expiry = new Date(Date.now() + 60 * 60_000);
    for (const [id, token, csrf] of [
      [ids.host, tokens.host, tokens.hostCsrf],
      [ids.member, tokens.member, tokens.memberCsrf],
      [ids.memberTwo, tokens.memberTwo, tokens.memberTwoCsrf],
    ] as const) {
      await prisma.guestSession.update({
        where: { id },
        data: {
          tokenHash: hashToken(token),
          csrfTokenHash: hashToken(csrf),
          idleExpiresAt: expiry,
          absoluteExpiresAt: expiry,
          revokedAt: null,
          lastSeenAt: new Date(),
        },
      });
    }
  }

  async function createActiveSession(): Promise<void> {
    const now = new Date();
    const activation = await prisma.activationRequest.create({
      data: {
        restaurantId: ids.restaurant,
        locationId: ids.location,
        tableId: ids.table,
        requesterGuestSessionId: ids.host,
        status: ActivationRequestStatus.APPROVED,
        expiresAt: new Date(now.getTime() + 5 * 60_000),
        handledByMembershipId: ids.membership,
        handledAt: now,
        version: 1,
      },
    });
    const session = await prisma.tableSession.create({
      data: {
        restaurantId: ids.restaurant,
        locationId: ids.location,
        tableId: ids.table,
        activationRequestId: activation.id,
        activatedByMembershipId: ids.membership,
      },
    });
    tableSessionId = session.id;
    await prisma.bill.create({
      data: {
        restaurantId: ids.restaurant,
        locationId: ids.location,
        tableSessionId,
      },
    });
    await prisma.guestSession.update({
      where: { id: ids.host },
      data: { tableSessionId, accessLevel: GuestAccessLevel.ORDER_ENABLED, version: 1 },
    });
    await prisma.restaurantTable.update({
      where: { id: ids.table },
      data: { physicalStatus: TablePhysicalStatus.OCCUPIED, version: 1 },
    });
  }

  beforeAll(async () => {
    const testingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    application = testingModule.createNestApplication();
    application.setGlobalPrefix('api/v1');
    application.useGlobalFilters(new FoundationExceptionFilter());
    await application.init();
    server = application.getHttpServer() as Server;
    prisma = application.get(PrismaService);

    await cleanup();
    await prisma.guestSession.deleteMany({
      where: { id: { in: [ids.host, ids.member, ids.memberTwo] } },
    });
    await prisma.staffMembership.deleteMany({ where: { id: ids.membership } });
    await prisma.staffUser.deleteMany({ where: { id: ids.staff } });
    await prisma.restaurantTable.deleteMany({ where: { id: ids.table } });
    await prisma.location.deleteMany({ where: { id: ids.location } });
    await prisma.restaurant.deleteMany({ where: { id: ids.restaurant } });
    await prisma.restaurant.create({
      data: { id: ids.restaurant, name: 'Join Test', status: RestaurantStatus.ACTIVE },
    });
    await prisma.location.create({
      data: {
        id: ids.location,
        restaurantId: ids.restaurant,
        code: 'JOIN',
        name: 'Join Test',
        isActive: true,
      },
    });
    await prisma.restaurantTable.create({
      data: {
        id: ids.table,
        restaurantId: ids.restaurant,
        locationId: ids.location,
        publicId: ids.tablePublic,
        code: 'J-1',
        capacity: 8,
      },
    });
    await prisma.staffUser.create({
      data: {
        id: ids.staff,
        email: 'join@example.test',
        passwordHash: 'unused',
        name: 'Join Staff',
      },
    });
    await prisma.staffMembership.create({
      data: {
        id: ids.membership,
        staffUserId: ids.staff,
        restaurantId: ids.restaurant,
        locationId: ids.location,
      },
    });
    const expiry = new Date(Date.now() + 60 * 60_000);
    await prisma.guestSession.createMany({
      data: [ids.host, ids.member, ids.memberTwo].map((id, index) => ({
        id,
        restaurantId: ids.restaurant,
        locationId: ids.location,
        tableId: ids.table,
        tokenHash: hashToken([tokens.host, tokens.member, tokens.memberTwo][index]!),
        csrfTokenHash: hashToken(
          [tokens.hostCsrf, tokens.memberCsrf, tokens.memberTwoCsrf][index]!,
        ),
        idleExpiresAt: expiry,
        absoluteExpiresAt: expiry,
      })),
    });
  });

  beforeEach(async () => {
    await cleanup();
    await resetCredentials();
    await createActiveSession();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.guestSession.deleteMany({
      where: { id: { in: [ids.host, ids.member, ids.memberTwo] } },
    });
    await prisma.staffMembership.deleteMany({ where: { id: ids.membership } });
    await prisma.staffUser.deleteMany({ where: { id: ids.staff } });
    await prisma.restaurantTable.deleteMany({ where: { id: ids.table } });
    await prisma.location.deleteMany({ where: { id: ids.location } });
    await prisma.restaurant.deleteMany({ where: { id: ids.restaurant } });
    await application.close();
  });

  it('allows only the verified Host to issue plaintext once without persisting it', async () => {
    const beforeIssue = Date.now();
    const issue = await hostIssue(0, false, 'host-issue').expect(200);
    const afterIssue = Date.now();
    const code = (issue.body as { data: { code: string } }).data.code;
    expect(code).toMatch(/^\d{6}$/);
    const stored = await prisma.sessionJoinCode.findFirstOrThrow({ where: { tableSessionId } });
    expect(stored.codeHash).toBe(joinFingerprint(code));
    expect(stored.expiresAt.getTime()).toBeGreaterThanOrEqual(beforeIssue + JOIN_CODE_TTL_MS);
    expect(stored.expiresAt.getTime()).toBeLessThanOrEqual(afterIssue + JOIN_CODE_TTL_MS);
    expect(
      JSON.stringify(
        await prisma.idempotencyRecord.findMany({ where: { restaurantId: ids.restaurant } }),
      ),
    ).not.toContain(code);
    expect(
      JSON.stringify(await prisma.auditLog.findMany({ where: { restaurantId: ids.restaurant } })),
    ).not.toContain(code);
    const replay = await hostIssue(0, false, 'host-issue').expect(200);
    expect(replay.body).toMatchObject({ data: { code: null, plaintextAvailable: false } });

    await request(server)
      .get('/api/v1/table-sessions/current/join-code')
      .set('Cookie', cookie(tokens.member))
      .expect(403);
  });

  it('requires explicit replacement and invalidates the previous code', async () => {
    const first = await hostIssue(0, false, 'first').expect(200);
    const oldCode = (first.body as { data: { code: string } }).data.code;
    await hostIssue(1, false, 'no-confirm').expect(409);
    const second = await hostIssue(1, true, 'replace').expect(200);
    const newCode = (second.body as { data: { code: string } }).data.code;
    expect(newCode).not.toBe(oldCode);
    await join(tokens.member, tokens.memberCsrf, oldCode, 'old-code').expect(403);
    await join(tokens.member, tokens.memberCsrf, newCode, 'new-code').expect(200);
  });

  it('joins multiple independent members without duplicating TableSession or Bill', async () => {
    const issued = await hostIssue(0, false, 'shared-code').expect(200);
    const code = (issued.body as { data: { code: string } }).data.code;
    const [one, two] = await Promise.all([
      join(tokens.member, tokens.memberCsrf, code, 'member-one'),
      join(tokens.memberTwo, tokens.memberTwoCsrf, code, 'member-two'),
    ]);
    expect(one.status).toBe(200);
    expect(two.status).toBe(200);
    await expect(prisma.tableSession.count({ where: { id: tableSessionId } })).resolves.toBe(1);
    await expect(prisma.bill.count({ where: { tableSessionId } })).resolves.toBe(1);
    await expect(
      prisma.guestSession.count({
        where: { tableSessionId, accessLevel: GuestAccessLevel.ORDER_ENABLED },
      }),
    ).resolves.toBe(3);
  });

  it('enforces the browser/table limiter atomically and stores fingerprints only', async () => {
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await join(tokens.member, tokens.memberCsrf, '000000', `bad-${attempt}`).expect(403);
    }
    await join(tokens.member, tokens.memberCsrf, '000000', 'bad-5').expect(429);
    const buckets = await prisma.joinAttemptRateLimit.findMany({ where: { tableSessionId } });
    expect(buckets).toHaveLength(3);
    expect(buckets.find((bucket) => bucket.dimension === 'GUEST_TABLE')).toMatchObject({
      failedAttempts: 5,
    });
    expect(buckets.map((bucket) => bucket.subjectHash)).not.toContain(joinFingerprint('000000'));
    expect(JSON.stringify(buckets)).not.toContain('127.0.0.1');
  });

  it('enforces IP and aggregate TableSession limits independently', async () => {
    await join(tokens.member, tokens.memberCsrf, '000000', 'prime-buckets').expect(403);
    await prisma.joinAttemptRateLimit.updateMany({
      where: { tableSessionId, dimension: 'IP_TABLE' },
      data: { failedAttempts: 19 },
    });
    await join(
      tokens.member,
      tokens.memberCsrf,
      '000000',
      'ip-threshold',
      '127.0.0.1',
      '203.0.113.250',
    ).expect(429);

    await prisma.joinAttemptRateLimit.updateMany({
      where: { tableSessionId },
      data: { failedAttempts: 0, blockedUntil: null },
    });
    await prisma.joinAttemptRateLimit.updateMany({
      where: { tableSessionId, dimension: 'TABLE_SESSION' },
      data: { failedAttempts: 99 },
    });
    await join(tokens.member, tokens.memberCsrf, '000000', 'aggregate-threshold').expect(429);
    const aggregate = await prisma.joinAttemptRateLimit.findFirstOrThrow({
      where: { tableSessionId, dimension: 'TABLE_SESSION' },
    });
    expect(aggregate).toMatchObject({ failedAttempts: 100 });
    expect(aggregate.blockedUntil).not.toBeNull();
  });

  it('creates distinct IP buckets only from trusted signed client addresses', async () => {
    await join(tokens.member, tokens.memberCsrf, '000000', 'ip-one', '203.0.113.10').expect(403);
    await join(tokens.memberTwo, tokens.memberTwoCsrf, '000000', 'ip-two', '203.0.113.11').expect(
      403,
    );
    const ipBuckets = await prisma.joinAttemptRateLimit.findMany({
      where: { tableSessionId, dimension: 'IP_TABLE' },
    });
    expect(ipBuckets).toHaveLength(2);
    expect(new Set(ipBuckets.map((bucket) => bucket.subjectHash)).size).toBe(2);
    expect(JSON.stringify(ipBuckets)).not.toContain('203.0.113.');
  });

  it('supports fixed-window lost-response recovery only with the same join operation key', async () => {
    const issued = await hostIssue(0, false, 'recovery-code').expect(200);
    const code = (issued.body as { data: { code: string } }).data.code;
    const beforeJoin = Date.now();
    const first = await join(tokens.member, tokens.memberCsrf, code, 'recover-join').expect(200);
    const afterJoin = Date.now();
    const retry = await join(tokens.member, tokens.memberCsrf, code, 'recover-join').expect(200);
    expect(retry.headers['set-cookie']).toBeDefined();
    const firstBody = first.body as { data: JoinTableData };
    expect(retry.body).toMatchObject({ data: { session: firstBody.data.session } });
    const rotated = await prisma.guestSession.findUniqueOrThrow({ where: { id: ids.member } });
    expect(rotated.previousTokenValidUntil?.getTime()).toBeGreaterThanOrEqual(
      beforeJoin + JOIN_RECOVERY_TTL_MS,
    );
    expect(rotated.previousTokenValidUntil?.getTime()).toBeLessThanOrEqual(
      afterJoin + JOIN_RECOVERY_TTL_MS,
    );
    await expect(
      prisma.auditLog.count({
        where: { actorId: ids.member, action: 'GUEST_JOINED_TABLE_SESSION' },
      }),
    ).resolves.toBe(1);
  });

  it('rejects expired codes without revoking guests that already joined', async () => {
    const issued = await hostIssue(0, false, 'expiry-code').expect(200);
    const code = (issued.body as { data: { code: string } }).data.code;
    await join(tokens.member, tokens.memberCsrf, code, 'joined-before-expiry').expect(200);
    await prisma.sessionJoinCode.updateMany({
      where: { tableSessionId, revokedAt: null },
      data: {
        createdAt: new Date(Date.now() - 31 * 60_000),
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
    await join(tokens.memberTwo, tokens.memberTwoCsrf, code, 'after-expiry').expect(403);
    await expect(
      prisma.guestSession.findUniqueOrThrow({ where: { id: ids.member } }),
    ).resolves.toMatchObject({ accessLevel: GuestAccessLevel.ORDER_ENABLED, tableSessionId });
  });
});
