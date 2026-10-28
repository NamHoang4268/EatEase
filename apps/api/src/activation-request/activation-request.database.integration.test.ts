import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module.js';
import { FoundationExceptionFilter } from '../common/filters/foundation-exception.filter.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  ActivationRequestStatus,
  RestaurantStatus,
  TablePhysicalStatus,
} from '../generated/prisma/enums.js';
import { GUEST_SESSION_COOKIE } from '../guest-session/guest-session.constants.js';
import { STAFF_SESSION_COOKIE } from '../staff-auth/auth.constants.js';
import { hashToken } from '../staff-auth/auth.crypto.js';

const databaseUrlValue = process.env.DATABASE_URL;
if (!databaseUrlValue)
  throw new Error('DATABASE_URL is required for activation integration tests.');

const databaseUrl = new URL(databaseUrlValue);
const databaseName = databaseUrl.pathname.replace(/^\//, '');
const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(databaseUrl.hostname);
if (!isLocalHost || (databaseName !== 'eatease_m2_test' && process.env.CI !== 'true')) {
  throw new Error(
    'Activation integration tests require isolated local eatease_m2_test or ephemeral CI.',
  );
}

process.env.NODE_ENV = 'test';
process.env.TRUSTED_WEB_ORIGINS = 'http://localhost:3000';
process.env.ACTIVATION_REQUEST_TTL_MINUTES = '5';

const ids = {
  restaurantA: '91000000-0000-4000-8000-000000000001',
  restaurantB: '91000000-0000-4000-8000-000000000002',
  locationA: '92000000-0000-4000-8000-000000000001',
  locationB: '92000000-0000-4000-8000-000000000002',
  tableA: '93000000-0000-4000-8000-000000000001',
  tableAPublic: '93100000-0000-4000-8000-000000000001',
  tableB: '93000000-0000-4000-8000-000000000002',
  tableBPublic: '93100000-0000-4000-8000-000000000002',
  staffAllowed: '94000000-0000-4000-8000-000000000001',
  staffDenied: '94000000-0000-4000-8000-000000000002',
  membershipAllowed: '95000000-0000-4000-8000-000000000001',
  membershipDenied: '95000000-0000-4000-8000-000000000002',
  role: '96000000-0000-4000-8000-000000000001',
  permission: '97000000-0000-4000-8000-000000000001',
} as const;

type GuestDevice = { cookie: string; csrfToken: string; sessionId: string };
type ActivationResponseBody = {
  data: { status: string; activationRequestId?: string; expiresAt?: string };
};

describe('activation request database integration', () => {
  let application: INestApplication;
  let server: Server;
  let prisma: PrismaService;

  async function cleanup(): Promise<void> {
    await prisma.idempotencyRecord.deleteMany({
      where: { restaurantId: { in: [ids.restaurantA, ids.restaurantB] } },
    });
    await prisma.activationRequest.deleteMany({
      where: { restaurantId: { in: [ids.restaurantA, ids.restaurantB] } },
    });
    await prisma.staffSession.deleteMany({
      where: { staffUserId: { in: [ids.staffAllowed, ids.staffDenied] } },
    });
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
    await prisma.guestSession.deleteMany({
      where: { restaurantId: { in: [ids.restaurantA, ids.restaurantB] } },
    });
    await prisma.restaurantTable.deleteMany({
      where: { restaurantId: { in: [ids.restaurantA, ids.restaurantB] } },
    });
    await prisma.location.deleteMany({
      where: { restaurantId: { in: [ids.restaurantA, ids.restaurantB] } },
    });
    await prisma.restaurant.deleteMany({
      where: { id: { in: [ids.restaurantA, ids.restaurantB] } },
    });
  }

  async function bootstrap(tablePublicId: string = ids.tableAPublic): Promise<GuestDevice> {
    const response = await request(server)
      .post('/api/v1/guest-sessions')
      .set('Origin', 'http://localhost:3000')
      .send({ tablePublicId })
      .expect(200);
    const cookie = (response.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    const token = new URLSearchParams(cookie.replace(`${GUEST_SESSION_COOKIE}=`, 'token=')).get(
      'token',
    )!;
    const session = await prisma.guestSession.findUniqueOrThrow({
      where: { tokenHash: hashToken(token) },
    });
    return {
      cookie,
      csrfToken: (response.body as { data: { csrfToken: string } }).data.csrfToken,
      sessionId: session.id,
    };
  }

  async function createStaffCookie(allowed: boolean, expired = false): Promise<string> {
    const rawToken = `activation-staff-${allowed ? 'allowed' : 'denied'}-${expired ? 'expired' : 'valid'}`;
    await prisma.staffSession.create({
      data: {
        staffUserId: allowed ? ids.staffAllowed : ids.staffDenied,
        membershipId: allowed ? ids.membershipAllowed : ids.membershipDenied,
        tokenHash: hashToken(rawToken),
        csrfTokenHash: hashToken('unused-csrf'),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    if (expired) {
      const stored = await prisma.staffSession.findUniqueOrThrow({
        where: { tokenHash: hashToken(rawToken) },
      });
      await prisma.staffSession.update({
        where: { id: stored.id },
        data: { expiresAt: new Date(stored.createdAt.getTime() + 1) },
      });
    }
    return `${STAFF_SESSION_COOKIE}=${encodeURIComponent(rawToken)}`;
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

    await prisma.restaurant.createMany({
      data: [
        { id: ids.restaurantA, name: 'Activation A', status: RestaurantStatus.ACTIVE },
        { id: ids.restaurantB, name: 'Activation B', status: RestaurantStatus.ACTIVE },
      ],
    });
    await prisma.location.createMany({
      data: [
        {
          id: ids.locationA,
          restaurantId: ids.restaurantA,
          code: 'ACT-A',
          name: 'Activation A',
          isActive: true,
        },
        {
          id: ids.locationB,
          restaurantId: ids.restaurantB,
          code: 'ACT-B',
          name: 'Activation B',
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
          code: 'A01',
          capacity: 4,
          physicalStatus: TablePhysicalStatus.AVAILABLE,
        },
        {
          id: ids.tableB,
          restaurantId: ids.restaurantB,
          locationId: ids.locationB,
          publicId: ids.tableBPublic,
          code: 'B01',
          capacity: 2,
          physicalStatus: TablePhysicalStatus.AVAILABLE,
        },
      ],
    });
    await prisma.staffUser.createMany({
      data: [
        {
          id: ids.staffAllowed,
          email: 'activation-reader@example.test',
          passwordHash: 'not-used',
          name: 'Activation Reader',
        },
        {
          id: ids.staffDenied,
          email: 'activation-denied@example.test',
          passwordHash: 'not-used',
          name: 'Activation Denied',
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
        code: 'ACTIVATION_READER',
        name: 'Activation reader',
      },
    });
    await prisma.permission.create({ data: { id: ids.permission, code: 'table.activation.read' } });
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
  });

  afterAll(async () => {
    await cleanup();
    await application.close();
  });

  it('enforces guest session, Origin, CSRF, table scope, and idempotency payload binding', async () => {
    await request(server)
      .post('/api/v1/activation-requests')
      .send({ tablePublicId: ids.tableAPublic })
      .expect(401);
    const device = await bootstrap();

    await request(server)
      .post('/api/v1/activation-requests')
      .set('Cookie', device.cookie)
      .set('Origin', 'http://localhost:3000')
      .set('Idempotency-Key', 'activation-security')
      .send({ tablePublicId: ids.tableAPublic })
      .expect(403);
    await request(server)
      .post('/api/v1/activation-requests')
      .set('Cookie', device.cookie)
      .set('Origin', 'https://attacker.test')
      .set('X-CSRF-Token', device.csrfToken)
      .set('Idempotency-Key', 'activation-security')
      .send({ tablePublicId: ids.tableAPublic })
      .expect(403);

    const first = await request(server)
      .post('/api/v1/activation-requests')
      .set('Cookie', device.cookie)
      .set('Origin', 'http://localhost:3000')
      .set('X-CSRF-Token', device.csrfToken)
      .set('Idempotency-Key', 'activation-security')
      .send({ tablePublicId: ids.tableAPublic })
      .expect(202);
    const replay = await request(server)
      .post('/api/v1/activation-requests')
      .set('Cookie', device.cookie)
      .set('Origin', 'http://localhost:3000')
      .set('X-CSRF-Token', device.csrfToken)
      .set('Idempotency-Key', 'activation-security')
      .send({ tablePublicId: ids.tableAPublic })
      .expect(202);
    expect(replay.body).toEqual(first.body);

    const conflict = await request(server)
      .post('/api/v1/activation-requests')
      .set('Cookie', device.cookie)
      .set('Origin', 'http://localhost:3000')
      .set('X-CSRF-Token', device.csrfToken)
      .set('Idempotency-Key', 'activation-security')
      .send({ tablePublicId: ids.tableBPublic })
      .expect(409);
    expect((conflict.body as { error: { code: string } }).error.code).toBe(
      'IDEMPOTENCY_KEY_REUSED',
    );
  });

  it('serializes concurrent devices and exposes only a generic waiting state to the loser', async () => {
    await prisma.activationRequest.deleteMany({ where: { tableId: ids.tableA } });
    const [deviceA, deviceB] = await Promise.all([bootstrap(), bootstrap()]);
    const submit = (device: GuestDevice, key: string) =>
      request(server)
        .post('/api/v1/activation-requests')
        .set('Cookie', device.cookie)
        .set('Origin', 'http://localhost:3000')
        .set('X-CSRF-Token', device.csrfToken)
        .set('Idempotency-Key', key)
        .send({ tablePublicId: ids.tableAPublic });
    const responses = await Promise.all([
      submit(deviceA, 'concurrent-a'),
      submit(deviceB, 'concurrent-b'),
    ]);

    expect(responses.map(({ status }) => status).sort()).toEqual([200, 202]);
    expect(
      await prisma.activationRequest.count({
        where: { tableId: ids.tableA, status: ActivationRequestStatus.PENDING },
      }),
    ).toBe(1);
    const genericResponse = responses.find(({ status }) => status === 200)!;
    const genericBody = genericResponse.body as ActivationResponseBody;
    expect(genericBody.data).toMatchObject({ status: 'PENDING' });
    expect(genericBody.data).not.toHaveProperty('activationRequestId');

    const genericPoll = await request(server)
      .get('/api/v1/activation-requests/current')
      .set('Cookie', genericResponse === responses[0] ? deviceA.cookie : deviceB.cookie)
      .expect(200);
    expect((genericPoll.body as ActivationResponseBody).data).not.toHaveProperty(
      'activationRequestId',
    );
  });

  it('projects expiry without GET writes and permits a new request through write-side expiry', async () => {
    await prisma.activationRequest.deleteMany({ where: { tableId: ids.tableA } });
    const device = await bootstrap();
    await request(server)
      .post('/api/v1/activation-requests')
      .set('Cookie', device.cookie)
      .set('Origin', 'http://localhost:3000')
      .set('X-CSRF-Token', device.csrfToken)
      .set('Idempotency-Key', 'expiry-first')
      .send({ tablePublicId: ids.tableAPublic })
      .expect(202);
    const stored = await prisma.activationRequest.findFirstOrThrow({
      where: { tableId: ids.tableA, status: ActivationRequestStatus.PENDING },
    });
    await prisma.activationRequest.update({
      where: { id: stored.id },
      data: { expiresAt: new Date(Date.now() - 1) },
    });

    const poll = await request(server)
      .get('/api/v1/activation-requests/current')
      .set('Cookie', device.cookie)
      .expect(200);
    expect((poll.body as ActivationResponseBody).data.status).toBe('EXPIRED');
    expect(
      (await prisma.activationRequest.findUniqueOrThrow({ where: { id: stored.id } })).status,
    ).toBe(ActivationRequestStatus.PENDING);

    await request(server)
      .post('/api/v1/activation-requests')
      .set('Cookie', device.cookie)
      .set('Origin', 'http://localhost:3000')
      .set('X-CSRF-Token', device.csrfToken)
      .set('Idempotency-Key', 'expiry-second')
      .send({ tablePublicId: ids.tableAPublic })
      .expect(202);
    expect(
      (await prisma.activationRequest.findUniqueOrThrow({ where: { id: stored.id } })).status,
    ).toBe(ActivationRequestStatus.EXPIRED);
  });

  it('enforces the partial unique index independently of application code', async () => {
    await prisma.activationRequest.deleteMany({ where: { tableId: ids.tableB } });
    const first = await bootstrap(ids.tableBPublic);
    const second = await bootstrap(ids.tableBPublic);
    await prisma.activationRequest.create({
      data: {
        restaurantId: ids.restaurantB,
        locationId: ids.locationB,
        tableId: ids.tableB,
        requesterGuestSessionId: first.sessionId,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await expect(
      prisma.activationRequest.create({
        data: {
          restaurantId: ids.restaurantB,
          locationId: ids.locationB,
          tableId: ids.tableB,
          requesterGuestSessionId: second.sessionId,
          expiresAt: new Date(Date.now() + 60_000),
        },
      }),
    ).rejects.toThrow();
  });

  it('requires an active authorized staff session and isolates the queue by location', async () => {
    const allowedCookie = await createStaffCookie(true);
    const deniedCookie = await createStaffCookie(false);
    const expiredCookie = await createStaffCookie(true, true);

    await request(server).get('/api/v1/staff/activation-requests?status=PENDING').expect(401);
    await request(server)
      .get('/api/v1/staff/activation-requests?status=PENDING')
      .set('Cookie', expiredCookie)
      .expect(401);
    await request(server)
      .get('/api/v1/staff/activation-requests?status=PENDING')
      .set('Cookie', deniedCookie)
      .expect(403);
    const response = await request(server)
      .get('/api/v1/staff/activation-requests?status=PENDING')
      .set('Cookie', allowedCookie)
      .expect(200);
    expect(
      (response.body as { data: Array<{ table: { publicId: string } }> }).data.every(
        (item) => item.table.publicId === ids.tableAPublic,
      ),
    ).toBe(true);
    expect(JSON.stringify(response.body)).not.toContain('requesterGuestSessionId');
  });
});
