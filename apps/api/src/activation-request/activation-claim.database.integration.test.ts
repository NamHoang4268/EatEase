import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
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

const databaseUrlValue = process.env.DATABASE_URL;
if (!databaseUrlValue) throw new Error('DATABASE_URL is required for claim integration tests.');
const databaseUrl = new URL(databaseUrlValue);
const databaseName = databaseUrl.pathname.replace(/^\//, '');
const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(databaseUrl.hostname);
if (!isLocalHost || (databaseName !== 'eatease_m2_test' && process.env.CI !== 'true')) {
  throw new Error('Claim tests require isolated local eatease_m2_test or ephemeral CI.');
}

process.env.NODE_ENV = 'test';
process.env.TRUSTED_WEB_ORIGINS = 'http://localhost:3000';
process.env.GUEST_CLAIM_RECOVERY_TTL_SECONDS = '120';

const ids = {
  restaurant: 'c1000000-0000-4000-8000-000000000001',
  location: 'c2000000-0000-4000-8000-000000000001',
  table: 'c3000000-0000-4000-8000-000000000001',
  tablePublic: 'c3100000-0000-4000-8000-000000000001',
  staff: 'c4000000-0000-4000-8000-000000000001',
  membership: 'c5000000-0000-4000-8000-000000000001',
  requester: 'c6000000-0000-4000-8000-000000000001',
  otherGuest: 'c6000000-0000-4000-8000-000000000002',
} as const;

const requesterToken = 'm2-6-c-requester-token';
const requesterCsrf = 'm2-6-c-requester-csrf';
const otherToken = 'm2-6-c-other-token';
const otherCsrf = 'm2-6-c-other-csrf';

type ErrorBody = { error: { code: string } };

describe('guest activation claim database integration', () => {
  let application: INestApplication;
  let server: Server;
  let prisma: PrismaService;

  const cookie = (token: string) => `${GUEST_SESSION_COOKIE}=${encodeURIComponent(token)}`;

  function responseCookieToken(response: request.Response): string {
    const header = response.headers['set-cookie'] as unknown;
    const value =
      typeof header === 'string'
        ? header
        : Array.isArray(header) && typeof header[0] === 'string'
          ? header[0]
          : undefined;
    const match = value?.match(new RegExp(`^${GUEST_SESSION_COOKIE}=([^;]+)`));
    if (!match?.[1]) throw new Error('Expected replacement guest cookie.');
    return decodeURIComponent(match[1]);
  }

  const claim = (
    token: string,
    csrf: string,
    key: string,
    expectedVersion = 1,
    origin = 'http://localhost:3000',
  ) =>
    request(server)
      .post('/api/v1/activation-requests/current/claim')
      .set('Cookie', cookie(token))
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', key)
      .send({ expectedVersion });

  async function cleanupOperations(): Promise<void> {
    await prisma.idempotencyRecord.deleteMany({ where: { restaurantId: ids.restaurant } });
    await prisma.auditLog.deleteMany({ where: { restaurantId: ids.restaurant } });
    await prisma.bill.deleteMany({ where: { restaurantId: ids.restaurant } });
    await prisma.guestSession.updateMany({
      where: { id: { in: [ids.requester, ids.otherGuest] } },
      data: {
        tableSessionId: null,
        accessLevel: GuestAccessLevel.BROWSE_ONLY,
        previousTokenHash: null,
        previousCsrfTokenHash: null,
        previousTokenValidUntil: null,
        revokedAt: null,
        version: 0,
      },
    });
    await prisma.tableSession.deleteMany({ where: { restaurantId: ids.restaurant } });
    await prisma.activationRequest.deleteMany({ where: { restaurantId: ids.restaurant } });
    await prisma.restaurantTable.updateMany({
      where: { id: ids.table },
      data: { physicalStatus: TablePhysicalStatus.AVAILABLE, version: 0 },
    });
  }

  async function resetGuestCredentials(): Promise<void> {
    const expiry = new Date(Date.now() + 60 * 60_000);
    await prisma.guestSession.update({
      where: { id: ids.requester },
      data: {
        tokenHash: hashToken(requesterToken),
        csrfTokenHash: hashToken(requesterCsrf),
        idleExpiresAt: expiry,
        absoluteExpiresAt: expiry,
        lastSeenAt: new Date(),
      },
    });
    await prisma.guestSession.update({
      where: { id: ids.otherGuest },
      data: {
        tokenHash: hashToken(otherToken),
        csrfTokenHash: hashToken(otherCsrf),
        idleExpiresAt: expiry,
        absoluteExpiresAt: expiry,
        lastSeenAt: new Date(),
      },
    });
  }

  async function createApprovedActivation() {
    const now = new Date();
    const activation = await prisma.activationRequest.create({
      data: {
        restaurantId: ids.restaurant,
        locationId: ids.location,
        tableId: ids.table,
        requesterGuestSessionId: ids.requester,
        status: ActivationRequestStatus.APPROVED,
        expiresAt: new Date(now.getTime() + 5 * 60_000),
        handledByMembershipId: ids.membership,
        handledAt: now,
        version: 1,
      },
    });
    const tableSession = await prisma.tableSession.create({
      data: {
        restaurantId: ids.restaurant,
        locationId: ids.location,
        tableId: ids.table,
        activationRequestId: activation.id,
        activatedByMembershipId: ids.membership,
        activatedAt: now,
      },
    });
    await prisma.bill.create({
      data: {
        restaurantId: ids.restaurant,
        locationId: ids.location,
        tableSessionId: tableSession.id,
      },
    });
    await prisma.restaurantTable.update({
      where: { id: ids.table },
      data: { physicalStatus: TablePhysicalStatus.OCCUPIED, version: 1 },
    });
    return { activation, tableSession };
  }

  beforeAll(async () => {
    const testingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    application = testingModule.createNestApplication();
    application.setGlobalPrefix('api/v1');
    application.useGlobalFilters(new FoundationExceptionFilter());
    await application.init();
    server = application.getHttpServer() as Server;
    prisma = application.get(PrismaService);

    await cleanupOperations();
    await prisma.guestSession.deleteMany({
      where: { id: { in: [ids.requester, ids.otherGuest] } },
    });
    await prisma.staffMembership.deleteMany({ where: { id: ids.membership } });
    await prisma.staffUser.deleteMany({ where: { id: ids.staff } });
    await prisma.restaurantTable.deleteMany({ where: { id: ids.table } });
    await prisma.location.deleteMany({ where: { id: ids.location } });
    await prisma.restaurant.deleteMany({ where: { id: ids.restaurant } });

    await prisma.restaurant.create({
      data: { id: ids.restaurant, name: 'Claim Test', status: RestaurantStatus.ACTIVE },
    });
    await prisma.location.create({
      data: {
        id: ids.location,
        restaurantId: ids.restaurant,
        code: 'CLAIM',
        name: 'Claim Test',
        isActive: true,
      },
    });
    await prisma.restaurantTable.create({
      data: {
        id: ids.table,
        restaurantId: ids.restaurant,
        locationId: ids.location,
        publicId: ids.tablePublic,
        code: 'C-1',
        capacity: 4,
      },
    });
    await prisma.staffUser.create({
      data: {
        id: ids.staff,
        email: 'claim-staff@example.test',
        passwordHash: 'not-used',
        name: 'Claim Staff',
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
      data: [
        {
          id: ids.requester,
          restaurantId: ids.restaurant,
          locationId: ids.location,
          tableId: ids.table,
          tokenHash: hashToken(requesterToken),
          csrfTokenHash: hashToken(requesterCsrf),
          idleExpiresAt: expiry,
          absoluteExpiresAt: expiry,
        },
        {
          id: ids.otherGuest,
          restaurantId: ids.restaurant,
          locationId: ids.location,
          tableId: ids.table,
          tokenHash: hashToken(otherToken),
          csrfTokenHash: hashToken(otherCsrf),
          idleExpiresAt: expiry,
          absoluteExpiresAt: expiry,
        },
      ],
    });
  });

  beforeEach(async () => {
    await cleanupOperations();
    await prisma.restaurant.update({
      where: { id: ids.restaurant },
      data: { status: RestaurantStatus.ACTIVE },
    });
    await prisma.location.update({ where: { id: ids.location }, data: { isActive: true } });
    await prisma.restaurantTable.update({ where: { id: ids.table }, data: { isActive: true } });
    await resetGuestCredentials();
  });

  afterAll(async () => {
    await cleanupOperations();
    await prisma.guestSession.deleteMany({
      where: { id: { in: [ids.requester, ids.otherGuest] } },
    });
    await prisma.staffMembership.deleteMany({ where: { id: ids.membership } });
    await prisma.staffUser.deleteMany({ where: { id: ids.staff } });
    await prisma.restaurantTable.deleteMany({ where: { id: ids.table } });
    await prisma.location.deleteMany({ where: { id: ids.location } });
    await prisma.restaurant.deleteMany({ where: { id: ids.restaurant } });
    await application.close();
  });

  it('claims only for the requester and rotates both credentials atomically', async () => {
    const { activation, tableSession } = await createApprovedActivation();
    const guestBeforeGet = await prisma.guestSession.findUniqueOrThrow({
      where: { id: ids.requester },
    });
    const currentBefore = await request(server)
      .get('/api/v1/activation-requests/current')
      .set('Cookie', cookie(requesterToken))
      .expect(200);
    expect(currentBefore.body).toEqual({
      data: {
        status: 'APPROVED',
        activationRequestId: activation.id,
        expiresAt: activation.expiresAt.toISOString(),
        version: 1,
        claimAvailable: true,
      },
    });
    const guestAfterGet = await prisma.guestSession.findUniqueOrThrow({
      where: { id: ids.requester },
    });
    expect(guestAfterGet).toEqual(guestBeforeGet);

    const response = await claim(requesterToken, requesterCsrf, 'claim-success').expect(200);
    const replacementToken = responseCookieToken(response);
    const replacementCsrf = (response.body as { data: { csrfToken: string } }).data.csrfToken;
    expect(replacementToken).not.toBe(requesterToken);
    expect(replacementCsrf).not.toBe(requesterCsrf);
    expect(response.body).toMatchObject({
      data: {
        session: {
          accessLevel: 'ORDER_ENABLED',
          tableSessionId: tableSession.id,
          version: 1,
        },
      },
    });

    const stored = await prisma.guestSession.findUniqueOrThrow({ where: { id: ids.requester } });
    expect(stored).toMatchObject({
      accessLevel: GuestAccessLevel.ORDER_ENABLED,
      tableSessionId: tableSession.id,
      tokenHash: hashToken(replacementToken),
      csrfTokenHash: hashToken(replacementCsrf),
      previousTokenHash: hashToken(requesterToken),
      previousCsrfTokenHash: hashToken(requesterCsrf),
      version: 1,
    });
    expect(stored.previousTokenValidUntil!.getTime() - stored.lastSeenAt.getTime()).toBe(120_000);
    expect(stored.idleExpiresAt.getTime() - stored.lastSeenAt.getTime()).toBe(30 * 60_000);
    await expect(
      prisma.auditLog.count({ where: { action: 'GUEST_ACTIVATION_CLAIMED' } }),
    ).resolves.toBe(1);
    await expect(prisma.tableSession.count({ where: { id: tableSession.id } })).resolves.toBe(1);
    await expect(prisma.bill.count({ where: { tableSessionId: tableSession.id } })).resolves.toBe(
      1,
    );
    await expect(
      prisma.activationRequest.findUniqueOrThrow({ where: { id: activation.id } }),
    ).resolves.toMatchObject({ version: 1 });
    const idempotency = await prisma.idempotencyRecord.findFirstOrThrow({
      where: { actorId: ids.requester, operation: 'CLAIM_ACTIVATION' },
    });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { actorId: ids.requester, action: 'GUEST_ACTIVATION_CLAIMED' },
    });
    const persistedReliabilityData = JSON.stringify({
      responseBody: idempotency.responseBody,
      auditMetadata: audit.metadata,
    });
    for (const secret of [requesterToken, requesterCsrf, replacementToken, replacementCsrf]) {
      expect(persistedReliabilityData).not.toContain(secret);
      expect(persistedReliabilityData).not.toContain(hashToken(secret));
    }

    const currentReplay = await claim(replacementToken, replacementCsrf, 'claim-success').expect(
      200,
    );
    expect(responseCookieToken(currentReplay)).toBe(replacementToken);
    expect((currentReplay.body as { data: { csrfToken: string } }).data.csrfToken).toBe(
      replacementCsrf,
    );
    await expect(
      prisma.auditLog.count({ where: { action: 'GUEST_ACTIVATION_CLAIMED' } }),
    ).resolves.toBe(1);

    await request(server)
      .get('/api/v1/guest-sessions/current')
      .set('Cookie', cookie(requesterToken))
      .expect(401);
    await request(server)
      .get('/api/v1/guest-sessions/current')
      .set('Cookie', cookie(replacementToken))
      .expect(200);
    const currentAfter = await request(server)
      .get('/api/v1/activation-requests/current')
      .set('Cookie', cookie(replacementToken))
      .expect(200);
    expect(currentAfter.body).not.toHaveProperty('data.claimAvailable');
  });

  it('denies another guest and enforces credentials, Origin, CSRF, and idempotency', async () => {
    await createApprovedActivation();
    const other = await claim(otherToken, otherCsrf, 'other-claim').expect(403);
    expect((other.body as ErrorBody).error.code).toBe('ACTIVATION_CLAIM_NOT_ALLOWED');
    await request(server)
      .post('/api/v1/activation-requests/current/claim')
      .set('Origin', 'http://localhost:3000')
      .set('X-CSRF-Token', requesterCsrf)
      .set('Idempotency-Key', 'missing-cookie')
      .send({ expectedVersion: 1 })
      .expect(401);
    await claim(requesterToken, requesterCsrf, 'bad-origin', 1, 'https://attacker.test').expect(
      403,
    );
    await claim(requesterToken, 'wrong-csrf', 'bad-csrf').expect(403);
    await request(server)
      .post('/api/v1/activation-requests/current/claim')
      .set('Cookie', cookie(requesterToken))
      .set('Origin', 'http://localhost:3000')
      .set('X-CSRF-Token', requesterCsrf)
      .send({ expectedVersion: 1 })
      .expect(400);
  });

  it('supports same-key lost-response recovery without extending the fixed deadline', async () => {
    await createApprovedActivation();
    const first = await claim(requesterToken, requesterCsrf, 'claim-recovery').expect(200);
    const firstCurrentToken = responseCookieToken(first);
    const originalDeadline = (
      await prisma.guestSession.findUniqueOrThrow({ where: { id: ids.requester } })
    ).previousTokenValidUntil!;

    const recovered = await claim(requesterToken, requesterCsrf, 'claim-recovery').expect(200);
    const recoveredToken = responseCookieToken(recovered);
    expect(recoveredToken).not.toBe(firstCurrentToken);
    const afterRecovery = await prisma.guestSession.findUniqueOrThrow({
      where: { id: ids.requester },
    });
    expect(afterRecovery.previousTokenValidUntil).toEqual(originalDeadline);
    expect(afterRecovery.version).toBe(1);
    await expect(
      prisma.auditLog.count({ where: { action: 'GUEST_ACTIVATION_CLAIMED' } }),
    ).resolves.toBe(1);
    await request(server)
      .get('/api/v1/guest-sessions/current')
      .set('Cookie', cookie(firstCurrentToken))
      .expect(401);
    await request(server)
      .get('/api/v1/guest-sessions/current')
      .set('Cookie', cookie(recoveredToken))
      .expect(200);
  });

  it('rejects expired recovery credentials and idempotency payload conflicts', async () => {
    await createApprovedActivation();
    await claim(requesterToken, requesterCsrf, 'claim-expiry').expect(200);
    const conflict = await claim(requesterToken, requesterCsrf, 'claim-expiry', 2).expect(409);
    expect((conflict.body as ErrorBody).error.code).toBe('IDEMPOTENCY_KEY_REUSED');

    await prisma.guestSession.update({
      where: { id: ids.requester },
      data: { previousTokenValidUntil: new Date(Date.now() - 1_000) },
    });
    await claim(requesterToken, requesterCsrf, 'claim-expiry').expect(401);
  });

  it('rejects stale versions, non-approved requests, and inactive scoped resources', async () => {
    const { activation } = await createApprovedActivation();
    const stale = await claim(requesterToken, requesterCsrf, 'claim-stale', 0).expect(409);
    expect((stale.body as ErrorBody).error.code).toBe('ACTIVATION_VERSION_CONFLICT');

    await prisma.bill.deleteMany({ where: { restaurantId: ids.restaurant } });
    await prisma.tableSession.deleteMany({ where: { restaurantId: ids.restaurant } });
    await prisma.activationRequest.update({
      where: { id: activation.id },
      data: {
        status: ActivationRequestStatus.REJECTED,
        rejectionReason: 'Rejected for claim test',
      },
    });
    const unavailable = await claim(requesterToken, requesterCsrf, 'claim-rejected', 1).expect(409);
    expect((unavailable.body as ErrorBody).error.code).toBe('ACTIVATION_CLAIM_NOT_AVAILABLE');

    await prisma.activationRequest.update({
      where: { id: activation.id },
      data: { status: ActivationRequestStatus.APPROVED, rejectionReason: null },
    });
    await prisma.location.update({ where: { id: ids.location }, data: { isActive: false } });
    await claim(requesterToken, requesterCsrf, 'claim-inactive-scope').expect(401);
  });

  it('allows one logical transition under concurrent claim attempts', async () => {
    await createApprovedActivation();
    const responses = await Promise.all([
      claim(requesterToken, requesterCsrf, 'claim-race-a'),
      claim(requesterToken, requesterCsrf, 'claim-race-b'),
    ]);
    expect(responses.map(({ status }) => status).sort()).toEqual([200, 401]);
    await expect(
      prisma.auditLog.count({ where: { action: 'GUEST_ACTIVATION_CLAIMED' } }),
    ).resolves.toBe(1);
    await expect(
      prisma.idempotencyRecord.count({ where: { operation: 'CLAIM_ACTIVATION' } }),
    ).resolves.toBe(1);
  });

  it('rolls back credential rotation and access upgrade when audit persistence fails', async () => {
    const { activation } = await createApprovedActivation();
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION m26c_fail_audit() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'forced M2.6-C audit failure';
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER m26c_fail_audit_trigger
      BEFORE INSERT ON audit_log
      FOR EACH ROW EXECUTE FUNCTION m26c_fail_audit();
    `);
    try {
      await claim(requesterToken, requesterCsrf, 'claim-rollback').expect(500);
    } finally {
      await prisma.$executeRawUnsafe(`
        DROP TRIGGER IF EXISTS m26c_fail_audit_trigger ON audit_log;
        DROP FUNCTION IF EXISTS m26c_fail_audit();
      `);
    }

    await expect(
      prisma.guestSession.findUniqueOrThrow({ where: { id: ids.requester } }),
    ).resolves.toMatchObject({
      accessLevel: GuestAccessLevel.BROWSE_ONLY,
      tableSessionId: null,
      tokenHash: hashToken(requesterToken),
      csrfTokenHash: hashToken(requesterCsrf),
      previousTokenHash: null,
      version: 0,
    });
    await expect(
      prisma.idempotencyRecord.count({ where: { operation: 'CLAIM_ACTIVATION' } }),
    ).resolves.toBe(0);
    await expect(
      prisma.activationRequest.findUniqueOrThrow({ where: { id: activation.id } }),
    ).resolves.toMatchObject({ version: 1 });
  });
});
