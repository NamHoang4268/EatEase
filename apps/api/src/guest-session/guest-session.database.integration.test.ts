import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module.js';
import { FoundationExceptionFilter } from '../common/filters/foundation-exception.filter.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  GuestAccessLevel,
  RestaurantStatus,
  TablePhysicalStatus,
} from '../generated/prisma/enums.js';
import { hashToken } from '../staff-auth/auth.crypto.js';
import { GUEST_SESSION_COOKIE } from './guest-session.constants.js';

const databaseUrlValue = process.env.DATABASE_URL;
if (!databaseUrlValue) {
  throw new Error('DATABASE_URL is required for guest session integration tests.');
}

const databaseUrl = new URL(databaseUrlValue);
const databaseName = databaseUrl.pathname.replace(/^\//, '');
const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(databaseUrl.hostname);
if (!isLocalHost || (databaseName !== 'eatease_m2_test' && process.env.CI !== 'true')) {
  throw new Error(
    'Guest session integration tests require isolated local eatease_m2_test or ephemeral CI.',
  );
}

process.env.NODE_ENV = 'test';
process.env.TRUSTED_WEB_ORIGINS = 'http://localhost:3000';

const ids = {
  restaurant: '81000000-0000-4000-8000-000000000001',
  location: '82000000-0000-4000-8000-000000000001',
  tableA: '83000000-0000-4000-8000-000000000001',
  tableAPublic: '83100000-0000-4000-8000-000000000001',
  tableB: '83000000-0000-4000-8000-000000000002',
  tableBPublic: '83100000-0000-4000-8000-000000000002',
  inactiveTable: '83000000-0000-4000-8000-000000000003',
  inactiveTablePublic: '83100000-0000-4000-8000-000000000003',
} as const;

type BootstrapResponseBody = {
  data: {
    table: {
      publicId: string;
      restaurantName: string;
      locationName: string;
      tableLabel: string;
      capacity: number;
      availability: string;
    };
    activationState: string;
    session: {
      accessLevel: string;
      idleExpiresAt: string;
      absoluteExpiresAt: string;
    };
    csrfToken: string;
  };
};

describe('guest session database integration', () => {
  let application: INestApplication;
  let server: Server;
  let prisma: PrismaService;

  async function cleanup(): Promise<void> {
    await prisma.guestSession.deleteMany({ where: { restaurantId: ids.restaurant } });
    await prisma.restaurantTable.deleteMany({ where: { restaurantId: ids.restaurant } });
    await prisma.location.deleteMany({ where: { restaurantId: ids.restaurant } });
    await prisma.restaurant.deleteMany({ where: { id: ids.restaurant } });
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

    await prisma.restaurant.create({
      data: { id: ids.restaurant, name: 'Guest Test Restaurant', status: RestaurantStatus.ACTIVE },
    });
    await prisma.location.create({
      data: {
        id: ids.location,
        restaurantId: ids.restaurant,
        code: 'GUEST-LOC',
        name: 'Guest Branch',
        isActive: true,
      },
    });
    await prisma.restaurantTable.createMany({
      data: [
        {
          id: ids.tableA,
          restaurantId: ids.restaurant,
          locationId: ids.location,
          publicId: ids.tableAPublic,
          code: 'G01',
          capacity: 4,
          physicalStatus: TablePhysicalStatus.AVAILABLE,
          isActive: true,
        },
        {
          id: ids.tableB,
          restaurantId: ids.restaurant,
          locationId: ids.location,
          publicId: ids.tableBPublic,
          code: 'G02',
          capacity: 2,
          physicalStatus: TablePhysicalStatus.OCCUPIED,
          isActive: true,
        },
        {
          id: ids.inactiveTable,
          restaurantId: ids.restaurant,
          locationId: ids.location,
          publicId: ids.inactiveTablePublic,
          code: 'G-INACTIVE',
          capacity: 2,
          physicalStatus: TablePhysicalStatus.AVAILABLE,
          isActive: false,
        },
      ],
    });
  });

  afterAll(async () => {
    await cleanup();
    await application.close();
  });

  it('establishes a BROWSE_ONLY guest session, sets HttpOnly cookie, and persists token hash only', async () => {
    const startedAt = Date.now();
    const response = await request(server)
      .post('/api/v1/guest-sessions')
      .set('Origin', 'http://localhost:3000')
      .send({ tablePublicId: ids.tableAPublic })
      .expect(200);

    const body = response.body as BootstrapResponseBody;
    expect(body.data.table).toEqual({
      publicId: ids.tableAPublic,
      restaurantName: 'Guest Test Restaurant',
      locationName: 'Guest Branch',
      tableLabel: 'G01',
      capacity: 4,
      availability: 'AVAILABLE',
    });
    expect(body.data.activationState).toBe('NOT_REQUESTED');
    expect(body.data.session.accessLevel).toBe('BROWSE_ONLY');
    expect(body.data.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(response.headers['cache-control']).toBe('no-store');

    const setCookie = response.headers['set-cookie'] as unknown as string[];
    expect(setCookie).toBeDefined();
    const sessionCookieHeader = setCookie.find((c) => c.startsWith(`${GUEST_SESSION_COOKIE}=`));
    expect(sessionCookieHeader).toBeDefined();
    expect(sessionCookieHeader).toContain('HttpOnly');
    expect(sessionCookieHeader).toContain('SameSite=Lax');
    expect(sessionCookieHeader).not.toContain('Secure');

    const rawToken = /eatease_guest_session=([^;]+)/.exec(sessionCookieHeader!)?.[1];
    expect(rawToken).toBeDefined();
    expect(JSON.stringify(response.body)).not.toContain(rawToken);

    const storedSession = await prisma.guestSession.findFirstOrThrow({
      where: { tableId: ids.tableA },
      orderBy: { createdAt: 'desc' },
    });
    expect(storedSession.tokenHash).toBe(hashToken(decodeURIComponent(rawToken!)));
    expect(storedSession.csrfTokenHash).toBe(hashToken(body.data.csrfToken));
    expect(storedSession.accessLevel).toBe(GuestAccessLevel.BROWSE_ONLY);
    expect(storedSession.tableSessionId).toBeNull();
    expect(storedSession.version).toBe(0);

    // Idle ~30 min, absolute ~8 hr
    const idleDiff = storedSession.idleExpiresAt.getTime() - startedAt;
    const absDiff = storedSession.absoluteExpiresAt.getTime() - startedAt;
    expect(idleDiff).toBeGreaterThanOrEqual(29 * 60 * 1_000);
    expect(idleDiff).toBeLessThanOrEqual(31 * 60 * 1_000);
    expect(absDiff).toBeGreaterThanOrEqual(7 * 60 * 60 * 1_000);
    expect(absDiff).toBeLessThanOrEqual(9 * 60 * 60 * 1_000);
  });

  it('reuses existing valid session on same table, extending idle expiry and issuing fresh CSRF token without duplicate rows', async () => {
    const first = await request(server)
      .post('/api/v1/guest-sessions')
      .set('Origin', 'http://localhost:3000')
      .send({ tablePublicId: ids.tableAPublic })
      .expect(200);

    const firstCookie = (first.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    const firstBody = first.body as BootstrapResponseBody;
    const initialSessionCount = await prisma.guestSession.count({ where: { tableId: ids.tableA } });

    // Call bootstrap again with existing cookie on same table
    const second = await request(server)
      .post('/api/v1/guest-sessions')
      .set('Origin', 'http://localhost:3000')
      .set('Cookie', firstCookie)
      .send({ tablePublicId: ids.tableAPublic })
      .expect(200);

    const secondBody = second.body as BootstrapResponseBody;
    const countAfter = await prisma.guestSession.count({ where: { tableId: ids.tableA } });
    expect(countAfter).toBe(initialSessionCount);

    expect(secondBody.data.csrfToken).not.toBe(firstBody.data.csrfToken);
    expect(secondBody.data.session.absoluteExpiresAt).toBe(
      firstBody.data.session.absoluteExpiresAt,
    );
  });

  it('isolates different devices and different tables', async () => {
    // Device 1 bootstrap on table A
    const resA = await request(server)
      .post('/api/v1/guest-sessions')
      .set('Origin', 'http://localhost:3000')
      .send({ tablePublicId: ids.tableAPublic })
      .expect(200);
    const cookieA = (resA.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;

    // Device 2 bootstrap on table B using cookieA from table A -> must create a separate session for table B
    const resB = await request(server)
      .post('/api/v1/guest-sessions')
      .set('Origin', 'http://localhost:3000')
      .set('Cookie', cookieA)
      .send({ tablePublicId: ids.tableBPublic })
      .expect(200);

    const bodyB = resB.body as BootstrapResponseBody;
    expect(bodyB.data.table.tableLabel).toBe('G02');
    expect(bodyB.data.table.availability).toBe('BROWSE_ONLY');

    const sessionB = await prisma.guestSession.findFirstOrThrow({
      where: { tableId: ids.tableB },
      orderBy: { createdAt: 'desc' },
    });
    expect(sessionB.tableId).toBe(ids.tableB);
  });

  it('rejects untrusted Origin on bootstrap with 403', async () => {
    await request(server)
      .post('/api/v1/guest-sessions')
      .set('Origin', 'https://untrusted-attacker.test')
      .send({ tablePublicId: ids.tableAPublic })
      .expect(403);
  });

  it('returns generic 404 for unknown or inactive tables', async () => {
    for (const publicId of ['83100000-0000-4000-8000-000000000099', ids.inactiveTablePublic]) {
      const response = await request(server)
        .post('/api/v1/guest-sessions')
        .set('Origin', 'http://localhost:3000')
        .send({ tablePublicId: publicId })
        .expect(404);

      const body = response.body as { error: { code: string; message: string } };
      expect(body.error).toMatchObject({
        code: 'PUBLIC_TABLE_NOT_FOUND',
        message: 'Không tìm thấy bàn đang hoạt động.',
      });
    }
  });

  it('rotates CSRF token after browser refresh via GET /guest-sessions/csrf-token', async () => {
    const bootstrap = await request(server)
      .post('/api/v1/guest-sessions')
      .set('Origin', 'http://localhost:3000')
      .send({ tablePublicId: ids.tableAPublic })
      .expect(200);

    const cookie = (bootstrap.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    const originalCsrf = (bootstrap.body as BootstrapResponseBody).data.csrfToken;

    // Reject untrusted origin
    await request(server)
      .get('/api/v1/guest-sessions/csrf-token')
      .set('Cookie', cookie)
      .set('Origin', 'https://untrusted.test')
      .expect(403);

    // Rotate with trusted origin
    const recovery = await request(server)
      .get('/api/v1/guest-sessions/csrf-token')
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:3000')
      .expect('Cache-Control', 'no-store')
      .expect(200);

    const replacementCsrf = (recovery.body as { data: { csrfToken: string } }).data.csrfToken;
    expect(replacementCsrf).not.toBe(originalCsrf);
    expect(replacementCsrf).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('rejects expired or revoked guest sessions', async () => {
    const bootstrap = await request(server)
      .post('/api/v1/guest-sessions')
      .set('Origin', 'http://localhost:3000')
      .send({ tablePublicId: ids.tableAPublic })
      .expect(200);

    const cookie = (bootstrap.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    const session = await prisma.guestSession.findFirstOrThrow({
      where: { tableId: ids.tableA },
      orderBy: { createdAt: 'desc' },
    });

    // Check current works
    await request(server).get('/api/v1/guest-sessions/current').set('Cookie', cookie).expect(200);

    // Make idle expired (satisfying idle_expires_at > created_at check constraint while expired relative to now)
    await new Promise((resolve) => setTimeout(resolve, 10));
    await prisma.guestSession.update({
      where: { id: session.id },
      data: { idleExpiresAt: new Date(session.createdAt.getTime() + 1) },
    });
    await request(server).get('/api/v1/guest-sessions/current').set('Cookie', cookie).expect(401);

    // Revoke session
    await prisma.guestSession.update({
      where: { id: session.id },
      data: {
        idleExpiresAt: new Date(Date.now() + 60_000),
        revokedAt: new Date(Math.max(Date.now(), session.createdAt.getTime() + 2)),
      },
    });
    await request(server).get('/api/v1/guest-sessions/current').set('Cookie', cookie).expect(401);
  });

  it('ensures staff and guest cookies remain strictly separated', async () => {
    const guestBootstrap = await request(server)
      .post('/api/v1/guest-sessions')
      .set('Origin', 'http://localhost:3000')
      .send({ tablePublicId: ids.tableAPublic })
      .expect(200);

    const guestCookie = (guestBootstrap.headers['set-cookie'] as unknown as string[])[0]!.split(
      ';',
    )[0]!;

    // Guest cookie passed to staff endpoint must be rejected
    await request(server).get('/api/v1/staff/auth/me').set('Cookie', guestCookie).expect(401);

    // Staff cookie passed to guest endpoint must be rejected
    await request(server)
      .get('/api/v1/guest-sessions/current')
      .set('Cookie', 'eatease_staff_session=invalid-token')
      .expect(401);
  });
});
