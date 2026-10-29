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
import { STAFF_SESSION_COOKIE } from '../staff-auth/auth.constants.js';
import { hashToken } from '../staff-auth/auth.crypto.js';

const databaseUrlValue = process.env.DATABASE_URL;
if (!databaseUrlValue) {
  throw new Error('DATABASE_URL is required for activation decision integration tests.');
}
const databaseUrl = new URL(databaseUrlValue);
const databaseName = databaseUrl.pathname.replace(/^\//, '');
const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(databaseUrl.hostname);
if (!isLocalHost || (databaseName !== 'eatease_m2_test' && process.env.CI !== 'true')) {
  throw new Error(
    'Activation decision tests require isolated local eatease_m2_test or ephemeral CI.',
  );
}

process.env.NODE_ENV = 'test';
process.env.TRUSTED_WEB_ORIGINS = 'http://localhost:3000';

const ids = {
  restaurantA: 'b1000000-0000-4000-8000-000000000001',
  restaurantB: 'b1000000-0000-4000-8000-000000000002',
  locationA: 'b2000000-0000-4000-8000-000000000001',
  locationB: 'b2000000-0000-4000-8000-000000000002',
  tableA: 'b3000000-0000-4000-8000-000000000001',
  tableB: 'b3000000-0000-4000-8000-000000000002',
  tableAPublic: 'b3100000-0000-4000-8000-000000000001',
  tableBPublic: 'b3100000-0000-4000-8000-000000000002',
  staffAllowed: 'b4000000-0000-4000-8000-000000000001',
  staffDenied: 'b4000000-0000-4000-8000-000000000002',
  membershipAllowed: 'b5000000-0000-4000-8000-000000000001',
  membershipDenied: 'b5000000-0000-4000-8000-000000000002',
  role: 'b6000000-0000-4000-8000-000000000001',
  permission: 'b6100000-0000-4000-8000-000000000001',
  guestA: 'b7000000-0000-4000-8000-000000000001',
  guestB: 'b7000000-0000-4000-8000-000000000002',
  sessionAllowed: 'b8000000-0000-4000-8000-000000000001',
  sessionDenied: 'b8000000-0000-4000-8000-000000000002',
  sessionRevoked: 'b8000000-0000-4000-8000-000000000003',
} as const;

const allowedToken = 'm2-6-b-allowed';
const deniedToken = 'm2-6-b-denied';
const revokedToken = 'm2-6-b-revoked';
const csrfToken = 'm2-6-b-csrf';

type ErrorBody = { error: { code: string } };

describe('staff activation approval and rejection database integration', () => {
  let application: INestApplication;
  let server: Server;
  let prisma: PrismaService;

  const cookie = (token: string) => `${STAFF_SESSION_COOKIE}=${encodeURIComponent(token)}`;

  async function cleanupOperations(): Promise<void> {
    await prisma.idempotencyRecord.deleteMany({
      where: { restaurantId: { in: [ids.restaurantA, ids.restaurantB] } },
    });
    await prisma.auditLog.deleteMany({
      where: { restaurantId: { in: [ids.restaurantA, ids.restaurantB] } },
    });
    await prisma.outboxEvent.deleteMany({
      where: { restaurantId: { in: [ids.restaurantA, ids.restaurantB] } },
    });
    await prisma.bill.deleteMany({
      where: { restaurantId: { in: [ids.restaurantA, ids.restaurantB] } },
    });
    await prisma.guestSession.updateMany({
      where: { id: { in: [ids.guestA, ids.guestB] } },
      data: { accessLevel: GuestAccessLevel.BROWSE_ONLY, tableSessionId: null },
    });
    await prisma.tableSession.deleteMany({
      where: { restaurantId: { in: [ids.restaurantA, ids.restaurantB] } },
    });
    await prisma.activationRequest.deleteMany({
      where: { restaurantId: { in: [ids.restaurantA, ids.restaurantB] } },
    });
    await prisma.staffSession.deleteMany({
      where: { id: { in: [ids.sessionAllowed, ids.sessionDenied, ids.sessionRevoked] } },
    });
    await prisma.restaurantTable.updateMany({
      where: { id: { in: [ids.tableA, ids.tableB] } },
      data: { physicalStatus: TablePhysicalStatus.AVAILABLE, version: 0, isActive: true },
    });
  }

  async function createStaffSessions(): Promise<void> {
    const createdAt = new Date(Date.now() - 1_000);
    const expiresAt = new Date(Date.now() + 60 * 60_000);
    await prisma.staffSession.createMany({
      data: [
        {
          id: ids.sessionAllowed,
          staffUserId: ids.staffAllowed,
          membershipId: ids.membershipAllowed,
          tokenHash: hashToken(allowedToken),
          csrfTokenHash: hashToken(csrfToken),
          expiresAt,
          createdAt,
        },
        {
          id: ids.sessionDenied,
          staffUserId: ids.staffDenied,
          membershipId: ids.membershipDenied,
          tokenHash: hashToken(deniedToken),
          csrfTokenHash: hashToken(csrfToken),
          expiresAt,
          createdAt,
        },
        {
          id: ids.sessionRevoked,
          staffUserId: ids.staffAllowed,
          membershipId: ids.membershipAllowed,
          tokenHash: hashToken(revokedToken),
          csrfTokenHash: hashToken(csrfToken),
          expiresAt,
          createdAt,
          revokedAt: new Date(),
        },
      ],
    });
  }

  async function createActivation(
    scope: 'A' | 'B' = 'A',
    options: { expired?: boolean; version?: number } = {},
  ) {
    const isA = scope === 'A';
    const createdAt = options.expired ? new Date(Date.now() - 10 * 60_000) : new Date();
    return prisma.activationRequest.create({
      data: {
        restaurantId: isA ? ids.restaurantA : ids.restaurantB,
        locationId: isA ? ids.locationA : ids.locationB,
        tableId: isA ? ids.tableA : ids.tableB,
        requesterGuestSessionId: isA ? ids.guestA : ids.guestB,
        createdAt,
        expiresAt: options.expired
          ? new Date(createdAt.getTime() + 5 * 60_000)
          : new Date(Date.now() + 5 * 60_000),
        version: options.version ?? 0,
      },
    });
  }

  const approve = (
    activationRequestId: string,
    key: string,
    expectedVersion = 0,
    options: { token?: string; origin?: string; csrf?: string } = {},
  ) =>
    request(server)
      .post(`/api/v1/staff/activation-requests/${activationRequestId}/approve`)
      .set('Cookie', cookie(options.token ?? allowedToken))
      .set('Origin', options.origin ?? 'http://localhost:3000')
      .set('X-CSRF-Token', options.csrf ?? csrfToken)
      .set('Idempotency-Key', key)
      .send({ expectedVersion, physicalPresenceConfirmed: true });

  const reject = (
    activationRequestId: string,
    key: string,
    expectedVersion = 0,
    options: { token?: string; origin?: string; csrf?: string; reason?: string } = {},
  ) =>
    request(server)
      .post(`/api/v1/staff/activation-requests/${activationRequestId}/reject`)
      .set('Cookie', cookie(options.token ?? allowedToken))
      .set('Origin', options.origin ?? 'http://localhost:3000')
      .set('X-CSRF-Token', options.csrf ?? csrfToken)
      .set('Idempotency-Key', key)
      .send({ expectedVersion, reason: options.reason ?? 'No guest present' });

  beforeAll(async () => {
    const testingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    application = testingModule.createNestApplication();
    application.setGlobalPrefix('api/v1');
    application.useGlobalFilters(new FoundationExceptionFilter());
    await application.init();
    server = application.getHttpServer() as Server;
    prisma = application.get(PrismaService);

    await cleanupOperations();
    await prisma.membershipRole.deleteMany({
      where: { membershipId: { in: [ids.membershipAllowed, ids.membershipDenied] } },
    });
    await prisma.rolePermission.deleteMany({ where: { roleId: ids.role } });
    await prisma.staffMembership.deleteMany({
      where: { id: { in: [ids.membershipAllowed, ids.membershipDenied] } },
    });
    await prisma.role.deleteMany({ where: { id: ids.role } });
    await prisma.permission.deleteMany({ where: { id: ids.permission } });
    await prisma.staffUser.deleteMany({
      where: { id: { in: [ids.staffAllowed, ids.staffDenied] } },
    });
    await prisma.guestSession.deleteMany({ where: { id: { in: [ids.guestA, ids.guestB] } } });
    await prisma.restaurantTable.deleteMany({ where: { id: { in: [ids.tableA, ids.tableB] } } });
    await prisma.location.deleteMany({ where: { id: { in: [ids.locationA, ids.locationB] } } });
    await prisma.restaurant.deleteMany({
      where: { id: { in: [ids.restaurantA, ids.restaurantB] } },
    });

    await prisma.restaurant.createMany({
      data: [
        { id: ids.restaurantA, name: 'Decision A', status: RestaurantStatus.ACTIVE },
        { id: ids.restaurantB, name: 'Decision B', status: RestaurantStatus.ACTIVE },
      ],
    });
    await prisma.location.createMany({
      data: [
        {
          id: ids.locationA,
          restaurantId: ids.restaurantA,
          code: 'DEC-A',
          name: 'Decision A',
          isActive: true,
        },
        {
          id: ids.locationB,
          restaurantId: ids.restaurantB,
          code: 'DEC-B',
          name: 'Decision B',
          isActive: true,
        },
      ],
    });
    await prisma.restaurantTable.createMany({
      data: [
        {
          id: ids.tableA,
          restaurantId: ids.restaurantA,
          locationId: ids.locationA,
          publicId: ids.tableAPublic,
          code: 'D-A1',
          capacity: 4,
        },
        {
          id: ids.tableB,
          restaurantId: ids.restaurantB,
          locationId: ids.locationB,
          publicId: ids.tableBPublic,
          code: 'D-B1',
          capacity: 2,
        },
      ],
    });
    await prisma.staffUser.createMany({
      data: [
        {
          id: ids.staffAllowed,
          email: 'decision-allowed@example.test',
          passwordHash: 'not-used',
          name: 'Decision Allowed',
        },
        {
          id: ids.staffDenied,
          email: 'decision-denied@example.test',
          passwordHash: 'not-used',
          name: 'Decision Denied',
        },
      ],
    });
    await prisma.staffMembership.createMany({
      data: [
        {
          id: ids.membershipAllowed,
          staffUserId: ids.staffAllowed,
          restaurantId: ids.restaurantA,
          locationId: ids.locationA,
        },
        {
          id: ids.membershipDenied,
          staffUserId: ids.staffDenied,
          restaurantId: ids.restaurantA,
          locationId: ids.locationA,
        },
      ],
    });
    await prisma.role.create({
      data: {
        id: ids.role,
        restaurantId: ids.restaurantA,
        code: 'ACTIVATION_APPROVER',
        name: 'Activation approver',
      },
    });
    await prisma.permission.create({
      data: { id: ids.permission, code: 'table.activation.approve' },
    });
    await prisma.rolePermission.create({
      data: { roleId: ids.role, permissionId: ids.permission },
    });
    await prisma.membershipRole.create({
      data: {
        membershipId: ids.membershipAllowed,
        roleId: ids.role,
        restaurantId: ids.restaurantA,
      },
    });
    await prisma.guestSession.createMany({
      data: [
        {
          id: ids.guestA,
          restaurantId: ids.restaurantA,
          locationId: ids.locationA,
          tableId: ids.tableA,
          tokenHash: '1'.repeat(64),
          csrfTokenHash: '2'.repeat(64),
          idleExpiresAt: new Date(Date.now() + 30 * 60_000),
          absoluteExpiresAt: new Date(Date.now() + 8 * 60 * 60_000),
        },
        {
          id: ids.guestB,
          restaurantId: ids.restaurantB,
          locationId: ids.locationB,
          tableId: ids.tableB,
          tokenHash: '3'.repeat(64),
          csrfTokenHash: '4'.repeat(64),
          idleExpiresAt: new Date(Date.now() + 30 * 60_000),
          absoluteExpiresAt: new Date(Date.now() + 8 * 60 * 60_000),
        },
      ],
    });
  });

  beforeEach(async () => {
    await cleanupOperations();
    await createStaffSessions();
  });

  afterAll(async () => {
    await cleanupOperations();
    await prisma.membershipRole.deleteMany({
      where: { membershipId: { in: [ids.membershipAllowed, ids.membershipDenied] } },
    });
    await prisma.rolePermission.deleteMany({ where: { roleId: ids.role } });
    await prisma.staffMembership.deleteMany({
      where: { id: { in: [ids.membershipAllowed, ids.membershipDenied] } },
    });
    await prisma.role.deleteMany({ where: { id: ids.role } });
    await prisma.permission.deleteMany({ where: { id: ids.permission } });
    await prisma.staffUser.deleteMany({
      where: { id: { in: [ids.staffAllowed, ids.staffDenied] } },
    });
    await prisma.guestSession.deleteMany({ where: { id: { in: [ids.guestA, ids.guestB] } } });
    await prisma.restaurantTable.deleteMany({ where: { id: { in: [ids.tableA, ids.tableB] } } });
    await prisma.location.deleteMany({ where: { id: { in: [ids.locationA, ids.locationB] } } });
    await prisma.restaurant.deleteMany({
      where: { id: { in: [ids.restaurantA, ids.restaurantB] } },
    });
    await application.close();
  });

  it('approves atomically without upgrading the guest credential', async () => {
    const activation = await createActivation();
    const guestBefore = await prisma.guestSession.findUniqueOrThrow({ where: { id: ids.guestA } });
    const response = await approve(activation.id, 'approve-success').expect(200);

    expect((response.body as { data: unknown }).data).toMatchObject({
      activationRequest: { id: activation.id, status: 'APPROVED', version: 1 },
      table: { publicId: ids.tableAPublic, physicalStatus: 'OCCUPIED', version: 1 },
      tableSession: { status: 'ACTIVE', version: 0 },
      bill: {
        status: 'OPEN',
        subtotalAmount: '0',
        adjustmentAmount: '0',
        totalAmount: '0',
        paidAmount: '0',
        balanceAmount: '0',
      },
    });
    expect(JSON.stringify(response.body)).not.toContain(ids.guestA);

    const stored = await prisma.activationRequest.findUniqueOrThrow({
      where: { id: activation.id },
    });
    const guestAfter = await prisma.guestSession.findUniqueOrThrow({ where: { id: ids.guestA } });
    expect(stored).toMatchObject({
      status: ActivationRequestStatus.APPROVED,
      handledByMembershipId: ids.membershipAllowed,
      version: 1,
    });
    expect(guestAfter).toMatchObject({
      accessLevel: GuestAccessLevel.BROWSE_ONLY,
      tableSessionId: null,
      tokenHash: guestBefore.tokenHash,
      csrfTokenHash: guestBefore.csrfTokenHash,
    });
    await expect(prisma.tableSession.count({ where: { tableId: ids.tableA } })).resolves.toBe(1);
    await expect(prisma.bill.count({ where: { restaurantId: ids.restaurantA } })).resolves.toBe(1);
    await expect(prisma.auditLog.count({ where: { action: 'ACTIVATION_APPROVED' } })).resolves.toBe(
      1,
    );
    await expect(
      prisma.outboxEvent.count({ where: { restaurantId: ids.restaurantA } }),
    ).resolves.toBe(2);
  });

  it('rejects atomically without creating a session, bill, or table transition', async () => {
    const activation = await createActivation();
    const response = await reject(activation.id, 'reject-success', 0, {
      reason: '  No guest at table  ',
    }).expect(200);
    expect(
      (response.body as { data: { activationRequest: unknown } }).data.activationRequest,
    ).toMatchObject({
      id: activation.id,
      status: 'REJECTED',
      version: 1,
      rejectionReason: 'No guest at table',
    });
    const replay = await reject(activation.id, 'reject-success', 0, {
      reason: '  No guest at table  ',
    }).expect(200);
    expect(replay.body).toEqual(response.body);
    const conflict = await reject(activation.id, 'reject-success', 0, {
      reason: 'Different reason',
    }).expect(409);
    expect((conflict.body as ErrorBody).error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    await expect(prisma.tableSession.count({ where: { tableId: ids.tableA } })).resolves.toBe(0);
    await expect(prisma.bill.count({ where: { restaurantId: ids.restaurantA } })).resolves.toBe(0);
    await expect(
      prisma.restaurantTable.findUniqueOrThrow({ where: { id: ids.tableA } }),
    ).resolves.toMatchObject({ physicalStatus: TablePhysicalStatus.AVAILABLE, version: 0 });
    await expect(prisma.auditLog.count({ where: { action: 'ACTIVATION_REJECTED' } })).resolves.toBe(
      1,
    );
    await expect(
      prisma.outboxEvent.count({ where: { restaurantId: ids.restaurantA } }),
    ).resolves.toBe(1);
  });

  it('serializes concurrent approvals', async () => {
    const activation = await createActivation();
    const responses = await Promise.all([
      approve(activation.id, 'approve-race-a'),
      approve(activation.id, 'approve-race-b'),
    ]);
    expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);
    await expect(prisma.tableSession.count({ where: { tableId: ids.tableA } })).resolves.toBe(1);
    await expect(prisma.bill.count({ where: { restaurantId: ids.restaurantA } })).resolves.toBe(1);
  });

  it('allows only one winner in an approve-versus-reject race', async () => {
    const activation = await createActivation();
    const responses = await Promise.all([
      approve(activation.id, 'decision-race-approve'),
      reject(activation.id, 'decision-race-reject'),
    ]);
    expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);

    const stored = await prisma.activationRequest.findUniqueOrThrow({
      where: { id: activation.id },
    });
    const sessionCount = await prisma.tableSession.count({ where: { tableId: ids.tableA } });
    expect(
      stored.status === ActivationRequestStatus.APPROVED
        ? sessionCount === 1
        : stored.status === ActivationRequestStatus.REJECTED && sessionCount === 0,
    ).toBe(true);
  });

  it('replays an identical command and rejects a different payload for the same key', async () => {
    const activation = await createActivation();
    const first = await approve(activation.id, 'approve-replay').expect(200);
    const replay = await approve(activation.id, 'approve-replay').expect(200);
    expect(replay.body).toEqual(first.body);

    const conflict = await approve(activation.id, 'approve-replay', 1).expect(409);
    expect((conflict.body as ErrorBody).error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    await expect(prisma.tableSession.count({ where: { tableId: ids.tableA } })).resolves.toBe(1);
    await expect(prisma.auditLog.count({ where: { action: 'ACTIVATION_APPROVED' } })).resolves.toBe(
      1,
    );
  });

  it('persists write-side expiry before returning the conflict', async () => {
    const activation = await createActivation('A', { expired: true });
    const response = await approve(activation.id, 'approve-expired').expect(409);
    expect((response.body as ErrorBody).error.code).toBe('ACTIVATION_REQUEST_EXPIRED');
    await expect(
      prisma.activationRequest.findUniqueOrThrow({ where: { id: activation.id } }),
    ).resolves.toMatchObject({ status: ActivationRequestStatus.EXPIRED, version: 1 });
    await expect(prisma.tableSession.count({ where: { tableId: ids.tableA } })).resolves.toBe(0);
  });

  it('rejects stale versions and unavailable table state without partial writes', async () => {
    const activation = await createActivation();
    const stale = await approve(activation.id, 'approve-stale', 1).expect(409);
    expect((stale.body as ErrorBody).error.code).toBe('ACTIVATION_VERSION_CONFLICT');

    await prisma.restaurantTable.update({
      where: { id: ids.tableA },
      data: { physicalStatus: TablePhysicalStatus.CLEANING },
    });
    const unavailable = await approve(activation.id, 'approve-unavailable').expect(409);
    expect((unavailable.body as ErrorBody).error.code).toBe('TABLE_NOT_AVAILABLE');
    await expect(
      prisma.activationRequest.findUniqueOrThrow({ where: { id: activation.id } }),
    ).resolves.toMatchObject({ status: ActivationRequestStatus.PENDING, version: 0 });
    await expect(prisma.auditLog.count({ where: { restaurantId: ids.restaurantA } })).resolves.toBe(
      0,
    );
  });

  it('denies wrong-location and unauthenticated or unauthorized staff operations', async () => {
    const activationA = await createActivation();
    const activationB = await createActivation('B');

    await request(server)
      .post(`/api/v1/staff/activation-requests/${activationA.id}/approve`)
      .set('Origin', 'http://localhost:3000')
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', 'missing-session')
      .send({ expectedVersion: 0, physicalPresenceConfirmed: true })
      .expect(401);
    await approve(activationA.id, 'revoked-session', 0, { token: revokedToken }).expect(401);
    await approve(activationA.id, 'missing-permission', 0, { token: deniedToken }).expect(403);
    await approve(activationA.id, 'wrong-location').expect(200);
    await approve(activationB.id, 'wrong-location-b').expect(403);
  });

  it('enforces trusted Origin, staff CSRF, and physical-presence attestation', async () => {
    const activation = await createActivation();
    await approve(activation.id, 'bad-origin', 0, { origin: 'https://attacker.test' }).expect(403);
    await approve(activation.id, 'bad-csrf', 0, { csrf: 'wrong-token' }).expect(403);
    const physicalPresence = await request(server)
      .post(`/api/v1/staff/activation-requests/${activation.id}/approve`)
      .set('Cookie', cookie(allowedToken))
      .set('Origin', 'http://localhost:3000')
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', 'presence-required')
      .send({ expectedVersion: 0, physicalPresenceConfirmed: false })
      .expect(400);
    expect((physicalPresence.body as ErrorBody).error.code).toBe(
      'PHYSICAL_PRESENCE_CONFIRMATION_REQUIRED',
    );
  });

  it('rolls back all approval effects when outbox persistence fails', async () => {
    const activation = await createActivation();
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION m26b_fail_outbox() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'forced M2.6-B outbox failure';
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER m26b_fail_outbox_trigger
      BEFORE INSERT ON outbox_event
      FOR EACH ROW EXECUTE FUNCTION m26b_fail_outbox();
    `);

    try {
      await approve(activation.id, 'approve-rollback').expect(500);
    } finally {
      await prisma.$executeRawUnsafe(`
        DROP TRIGGER IF EXISTS m26b_fail_outbox_trigger ON outbox_event;
        DROP FUNCTION IF EXISTS m26b_fail_outbox();
      `);
    }

    await expect(
      prisma.activationRequest.findUniqueOrThrow({ where: { id: activation.id } }),
    ).resolves.toMatchObject({ status: ActivationRequestStatus.PENDING, version: 0 });
    await expect(
      prisma.restaurantTable.findUniqueOrThrow({ where: { id: ids.tableA } }),
    ).resolves.toMatchObject({ physicalStatus: TablePhysicalStatus.AVAILABLE, version: 0 });
    await expect(prisma.tableSession.count({ where: { tableId: ids.tableA } })).resolves.toBe(0);
    await expect(prisma.bill.count({ where: { restaurantId: ids.restaurantA } })).resolves.toBe(0);
    await expect(prisma.auditLog.count({ where: { restaurantId: ids.restaurantA } })).resolves.toBe(
      0,
    );
    await expect(
      prisma.idempotencyRecord.count({ where: { restaurantId: ids.restaurantA } }),
    ).resolves.toBe(0);
  });
});
