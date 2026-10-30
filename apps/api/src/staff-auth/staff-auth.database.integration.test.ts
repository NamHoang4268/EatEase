import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module.js';
import { PrismaService } from '../database/prisma.service.js';
import { StaffMembershipStatus, StaffUserStatus } from '../generated/prisma/enums.js';
import { FoundationExceptionFilter } from '../common/filters/foundation-exception.filter.js';
import { STAFF_SESSION_TTL_MS } from './auth.constants.js';
import { hashPassword, hashToken } from './auth.crypto.js';

const databaseUrlValue = process.env.DATABASE_URL;
if (!databaseUrlValue)
  throw new Error('DATABASE_URL is required for staff auth integration tests.');

const databaseUrl = new URL(databaseUrlValue);
const databaseName = databaseUrl.pathname.replace(/^\//, '');
const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(databaseUrl.hostname);
if (!isLocalHost || (databaseName !== 'eatease_m2_test' && process.env.CI !== 'true')) {
  throw new Error(
    'Staff auth integration tests require isolated local eatease_m2_test or ephemeral CI.',
  );
}

process.env.NODE_ENV = 'test';
process.env.TRUSTED_WEB_ORIGINS = 'http://localhost:3000';

const ids = {
  restaurantA: '71000000-0000-4000-8000-000000000001',
  restaurantB: '71000000-0000-4000-8000-000000000002',
  locationA: '72000000-0000-4000-8000-000000000001',
  locationB: '72000000-0000-4000-8000-000000000002',
  user: '73000000-0000-4000-8000-000000000001',
  membership: '74000000-0000-4000-8000-000000000001',
  roleA: '75000000-0000-4000-8000-000000000001',
  roleB: '75000000-0000-4000-8000-000000000002',
  permission: '76000000-0000-4000-8000-000000000001',
} as const;

type CsrfResponse = { data: { csrfToken: string } };
type ErrorResponse = { error: { code: string; message: string } };

describe('staff authentication database integration', () => {
  let application: INestApplication;
  let server: Server;
  let prisma: PrismaService;

  async function cleanup(): Promise<void> {
    await prisma.staffSession.deleteMany({ where: { staffUserId: ids.user } });
    await prisma.membershipRole.deleteMany({ where: { membershipId: ids.membership } });
    await prisma.rolePermission.deleteMany({ where: { roleId: { in: [ids.roleA, ids.roleB] } } });
    await prisma.staffMembership.deleteMany({ where: { staffUserId: ids.user } });
    await prisma.role.deleteMany({ where: { id: { in: [ids.roleA, ids.roleB] } } });
    await prisma.permission.deleteMany({ where: { id: ids.permission } });
    await prisma.staffUser.deleteMany({ where: { id: ids.user } });
    await prisma.location.deleteMany({ where: { id: { in: [ids.locationA, ids.locationB] } } });
    await prisma.restaurant.deleteMany({
      where: { id: { in: [ids.restaurantA, ids.restaurantB] } },
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

    await prisma.restaurant.createMany({
      data: [
        { id: ids.restaurantA, name: 'Auth Test A' },
        { id: ids.restaurantB, name: 'Auth Test B' },
      ],
    });
    await prisma.location.createMany({
      data: [
        {
          id: ids.locationA,
          restaurantId: ids.restaurantA,
          code: 'AUTH-A',
          name: 'Auth A',
          isActive: true,
        },
        {
          id: ids.locationB,
          restaurantId: ids.restaurantB,
          code: 'AUTH-B',
          name: 'Auth B',
          isActive: true,
        },
      ],
    });
    await prisma.staffUser.create({
      data: {
        id: ids.user,
        email: 'manager@example.test',
        name: 'Demo Manager',
        passwordHash: await hashPassword('correct horse battery staple'),
      },
    });
    await prisma.staffMembership.create({
      data: {
        id: ids.membership,
        staffUserId: ids.user,
        restaurantId: ids.restaurantA,
        locationId: ids.locationA,
      },
    });
    await prisma.role.createMany({
      data: [
        { id: ids.roleA, restaurantId: ids.restaurantA, code: 'MANAGER', name: 'Manager' },
        { id: ids.roleB, restaurantId: ids.restaurantB, code: 'MANAGER', name: 'Manager' },
      ],
    });
    await prisma.permission.create({ data: { id: ids.permission, code: 'menu.manage' } });
    await prisma.rolePermission.create({
      data: { roleId: ids.roleA, permissionId: ids.permission },
    });
    await prisma.membershipRole.create({
      data: { membershipId: ids.membership, roleId: ids.roleA, restaurantId: ids.restaurantA },
    });
  });

  afterAll(async () => {
    await cleanup();
    await application.close();
  });

  it('logs in with normalized email, persists only token hashes, and uses an eight-hour absolute expiry', async () => {
    const startedAt = Date.now();
    const response = await request(server)
      .post('/api/v1/staff/auth/login')
      .set('Origin', 'http://localhost:3000')
      .send({
        email: ' MANAGER@EXAMPLE.TEST ',
        password: 'correct horse battery staple',
        locationId: ids.locationA,
      })
      .expect(200);

    const setCookie = response.headers['set-cookie'] as unknown as string[];
    const responseBody = response.body as CsrfResponse;
    const sessionToken = /eatease_staff_session=([^;]+)/.exec(setCookie[0] ?? '')?.[1];
    expect(sessionToken).toBeDefined();
    expect(setCookie[0]).toContain('HttpOnly');
    expect(setCookie[0]).toContain('SameSite=Lax');
    expect(setCookie[0]).not.toContain('Secure');
    expect(responseBody.data.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(JSON.stringify(response.body)).not.toContain(sessionToken);

    const stored = await prisma.staffSession.findFirstOrThrow({
      where: { staffUserId: ids.user },
      orderBy: { createdAt: 'desc' },
    });
    expect(stored.tokenHash).toBe(hashToken(decodeURIComponent(sessionToken!)));
    expect(stored.tokenHash).not.toBe(sessionToken);
    expect(stored.csrfTokenHash).toBe(hashToken(responseBody.data.csrfToken));
    expect(stored.expiresAt.getTime() - startedAt).toBeGreaterThanOrEqual(
      STAFF_SESSION_TTL_MS - 2_000,
    );
    expect(stored.expiresAt.getTime() - startedAt).toBeLessThanOrEqual(
      STAFF_SESSION_TTL_MS + 2_000,
    );

    const cookie = setCookie[0]!.split(';')[0]!;
    await request(server).get('/api/v1/staff/auth/me').set('Cookie', cookie).expect(200);
    const afterRead = await prisma.staffSession.findUniqueOrThrow({ where: { id: stored.id } });
    expect(afterRead.expiresAt).toEqual(stored.expiresAt);
  });

  it('rotates the CSRF token after refresh and requires trusted origin plus the replacement token for logout', async () => {
    await request(server)
      .get('/api/v1/staff/auth/csrf-token')
      .set('Origin', 'http://localhost:3000')
      .expect(401);
    await request(server)
      .post('/api/v1/staff/auth/login')
      .set('Origin', 'https://untrusted.example')
      .send({ email: 'manager@example.test', password: 'correct horse battery staple' })
      .expect(403);
    const login = await request(server)
      .post('/api/v1/staff/auth/login')
      .set('Origin', 'http://localhost:3000')
      .send({ email: 'manager@example.test', password: 'correct horse battery staple' })
      .expect(200);
    const cookie = (login.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    const originalCsrf = (login.body as CsrfResponse).data.csrfToken;

    await request(server)
      .get('/api/v1/staff/auth/csrf-token')
      .set('Cookie', cookie)
      .set('Origin', 'https://untrusted.example')
      .expect(403);
    const recovery = await request(server)
      .get('/api/v1/staff/auth/csrf-token')
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:3000')
      .expect('Cache-Control', 'no-store')
      .expect(200);
    const replacementCsrf = (recovery.body as CsrfResponse).data.csrfToken;
    expect(replacementCsrf).not.toBe(originalCsrf);

    await request(server)
      .post('/api/v1/staff/auth/logout')
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:3000')
      .expect(403);
    await request(server)
      .post('/api/v1/staff/auth/logout')
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:3000')
      .set('X-CSRF-Token', originalCsrf)
      .expect(403);
    await request(server)
      .post('/api/v1/staff/auth/logout')
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:3000')
      .set('X-CSRF-Token', replacementCsrf)
      .expect(204);
    await request(server).get('/api/v1/staff/auth/me').set('Cookie', cookie).expect(401);
  });

  it('rejects expired sessions and sessions whose membership becomes revoked', async () => {
    const expiredLogin = await request(server)
      .post('/api/v1/staff/auth/login')
      .set('Origin', 'http://localhost:3000')
      .send({ email: 'manager@example.test', password: 'correct horse battery staple' })
      .expect(200);
    const expiredCookie = (expiredLogin.headers['set-cookie'] as unknown as string[])[0]!.split(
      ';',
    )[0]!;
    const expiredSession = await prisma.staffSession.findFirstOrThrow({
      where: { staffUserId: ids.user },
      orderBy: { createdAt: 'desc' },
    });
    await prisma.staffSession.update({
      where: { id: expiredSession.id },
      data: { expiresAt: new Date(expiredSession.createdAt.getTime() + 1) },
    });
    await request(server).get('/api/v1/staff/auth/me').set('Cookie', expiredCookie).expect(401);

    const revokedMembershipLogin = await request(server)
      .post('/api/v1/staff/auth/login')
      .set('Origin', 'http://localhost:3000')
      .send({ email: 'manager@example.test', password: 'correct horse battery staple' })
      .expect(200);
    const revokedMembershipCookie = (
      revokedMembershipLogin.headers['set-cookie'] as unknown as string[]
    )[0]!.split(';')[0]!;
    await prisma.staffMembership.update({
      where: { id: ids.membership },
      data: { status: StaffMembershipStatus.REVOKED },
    });
    await request(server)
      .get('/api/v1/staff/auth/me')
      .set('Cookie', revokedMembershipCookie)
      .expect(401);
    await prisma.staffMembership.update({
      where: { id: ids.membership },
      data: { status: StaffMembershipStatus.ACTIVE },
    });
  });

  it('returns generic login failures and rejects inactive identities and memberships', async () => {
    const wrongPassword = await request(server)
      .post('/api/v1/staff/auth/login')
      .set('Origin', 'http://localhost:3000')
      .send({ email: 'manager@example.test', password: 'wrong password' })
      .expect(401);
    const unknownUser = await request(server)
      .post('/api/v1/staff/auth/login')
      .set('Origin', 'http://localhost:3000')
      .send({ email: 'unknown@example.test', password: 'wrong password' })
      .expect(401);
    const wrongPasswordBody = wrongPassword.body as ErrorResponse;
    const unknownUserBody = unknownUser.body as ErrorResponse;
    expect(wrongPasswordBody.error.code).toBe('STAFF_AUTHENTICATION_FAILED');
    expect(unknownUserBody.error.code).toBe(wrongPasswordBody.error.code);
    expect(unknownUserBody.error.message).toBe(wrongPasswordBody.error.message);

    await prisma.staffUser.update({
      where: { id: ids.user },
      data: { status: StaffUserStatus.INACTIVE },
    });
    await request(server)
      .post('/api/v1/staff/auth/login')
      .set('Origin', 'http://localhost:3000')
      .send({ email: 'manager@example.test', password: 'correct horse battery staple' })
      .expect(401);
    await prisma.staffUser.update({
      where: { id: ids.user },
      data: { status: StaffUserStatus.ACTIVE },
    });
    await prisma.staffMembership.update({
      where: { id: ids.membership },
      data: { status: StaffMembershipStatus.INACTIVE },
    });
    await request(server)
      .post('/api/v1/staff/auth/login')
      .set('Origin', 'http://localhost:3000')
      .send({ email: 'manager@example.test', password: 'correct horse battery staple' })
      .expect(401);
    await prisma.staffMembership.update({
      where: { id: ids.membership },
      data: { status: StaffMembershipStatus.ACTIVE },
    });
  });

  it('enforces rate limiting and database tenant/session constraints', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(server)
        .post('/api/v1/staff/auth/login')
        .set('Origin', 'http://localhost:3000')
        .send({ email: 'limited@example.test', password: 'wrong password' })
        .expect(401);
    }
    await request(server)
      .post('/api/v1/staff/auth/login')
      .set('Origin', 'http://localhost:3000')
      .send({ email: 'limited@example.test', password: 'wrong password' })
      .expect(429);

    await expect(
      prisma.membershipRole.create({
        data: { membershipId: ids.membership, roleId: ids.roleB, restaurantId: ids.restaurantB },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.staffSession.create({
        data: {
          staffUserId: ids.user,
          membershipId: ids.membership,
          tokenHash: 'not-a-sha256-hash',
          csrfTokenHash: 'also-invalid',
          expiresAt: new Date(Date.now() + 60_000),
        },
      }),
    ).rejects.toThrow();
  });
});
