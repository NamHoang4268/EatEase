import { BadRequestException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GuestCookieService } from '../guest-session/guest-cookie.service.js';
import { GuestCsrfGuard } from '../guest-session/guest-csrf.guard.js';
import { GuestSessionGuard } from '../guest-session/guest-session.guard.js';
import { GuestSessionService } from '../guest-session/guest-session.service.js';
import type { GuestRequest } from '../guest-session/guest-session.types.js';
import { OriginPolicyService } from '../staff-auth/origin-policy.service.js';
import type { StaffRequest } from '../staff-auth/staff-auth.types.js';
import { GuestJoinCodeController, StaffJoinCodeController } from './join-code.controller.js';
import { JoinCodeService } from './join-code.service.js';
import {
  createProxySignature,
  JoinSourceIpService,
  TRUSTED_CLIENT_IP_HEADER,
  TRUSTED_PROXY_SIGNATURE_HEADER,
  TRUSTED_PROXY_TIMESTAMP_HEADER,
} from './join-source-ip.service.js';

const guestPrincipal = {
  sessionId: 'guest-1',
  restaurantId: 'restaurant-1',
  locationId: 'location-1',
  tableId: 'table-1',
  tablePublicId: '31000000-0000-4000-8000-000000000001',
  accessLevel: 'ORDER_ENABLED' as const,
  idleExpiresAt: new Date(),
  absoluteExpiresAt: new Date(),
  csrfTokenHash: 'hash',
};

const staffPrincipal = {
  sessionId: 'staff-session-1',
  staffUserId: 'staff-1',
  membershipId: 'membership-1',
  restaurantId: 'restaurant-1',
  locationId: 'location-1',
  email: 'staff@example.test',
  name: 'Staff',
  permissions: ['table.join_code.manage'],
  csrfTokenHash: 'hash',
};

describe('Join Code controllers', () => {
  it('forwards the exact Host issue contract', async () => {
    const service = { issueForHost: vi.fn().mockResolvedValue({ code: '123456' }) };
    const controller = new GuestJoinCodeController(
      service as unknown as JoinCodeService,
      {} as GuestCookieService,
      {} as OriginPolicyService,
      {} as JoinSourceIpService,
    );
    const result = await controller.issue(
      { expectedVersion: 2, replaceExisting: true },
      'host-key',
      { guestPrincipal } as GuestRequest,
    );
    expect(result).toEqual({ data: { code: '123456' } });
    expect(service.issueForHost).toHaveBeenCalledWith({
      expectedVersion: 2,
      replaceExisting: true,
      idempotencyKey: 'host-key',
      principal: guestPrincipal,
    });
  });

  it('rejects malformed Join Codes before service execution', async () => {
    const controller = new GuestJoinCodeController(
      {} as JoinCodeService,
      {} as GuestCookieService,
      { assertTrusted: vi.fn() } as unknown as OriginPolicyService,
      {} as JoinSourceIpService,
    );
    await expect(
      controller.join(
        { tablePublicId: guestPrincipal.tablePublicId, joinCode: '12345' },
        'join-key',
        { headers: {}, ip: '127.0.0.1' } as never,
        {} as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('forwards staff scope and optimistic version to rotation', async () => {
    const service = { issueForStaff: vi.fn().mockResolvedValue({ code: '654321' }) };
    const controller = new StaffJoinCodeController(service as unknown as JoinCodeService);
    await controller.issue(
      '51000000-0000-4000-8000-000000000001',
      { expectedVersion: 4, replaceExisting: false },
      'staff-key',
      { staffPrincipal } as unknown as StaffRequest,
    );
    expect(service.issueForStaff).toHaveBeenCalledWith({
      tableSessionId: '51000000-0000-4000-8000-000000000001',
      expectedVersion: 4,
      replaceExisting: false,
      idempotencyKey: 'staff-key',
      principal: staffPrincipal,
    });
  });
});

describe('Guest Join Code trusted proxy boundary', () => {
  let application: INestApplication | undefined;

  afterEach(async () => {
    await application?.close();
    application = undefined;
  });

  it('separates signed client IPs and ignores spoofed forwarded headers', async () => {
    const sharedSecret = 'request-test-api-proxy-secret-at-least-32-characters';
    const join = vi.fn().mockResolvedValue({
      data: { session: { id: 'guest-1', accessLevel: 'ORDER_ENABLED' } },
      sessionToken: 'rotated-token',
      csrfToken: 'rotated-csrf',
      absoluteExpiresAt: new Date(Date.now() + 60_000),
    });
    const testingModule = await Test.createTestingModule({
      controllers: [GuestJoinCodeController],
      providers: [
        { provide: JoinCodeService, useValue: { join } },
        {
          provide: GuestCookieService,
          useValue: { read: vi.fn().mockReturnValue('guest-token'), set: vi.fn() },
        },
        { provide: OriginPolicyService, useValue: { assertTrusted: vi.fn() } },
        {
          provide: JoinSourceIpService,
          useValue: new JoinSourceIpService({ signatureRequired: true, sharedSecret }),
        },
        { provide: GuestSessionGuard, useValue: { canActivate: () => true } },
        { provide: GuestCsrfGuard, useValue: { canActivate: () => true } },
        { provide: GuestSessionService, useValue: { authenticate: vi.fn() } },
      ],
    }).compile();
    application = testingModule.createNestApplication();
    application.setGlobalPrefix('api/v1');
    await application.init();
    const server = application.getHttpServer() as Server;
    const pathname = '/api/v1/table-sessions/join';

    const send = (clientIp: string, key: string, forwardedFor: string) => {
      const timestamp = String(Date.now());
      const signature = createProxySignature(sharedSecret, {
        clientIp,
        method: 'POST',
        pathname,
        timestamp,
      });
      return request(server)
        .post(pathname)
        .set('Idempotency-Key', key)
        .set('X-CSRF-Token', 'guest-csrf')
        .set('X-Forwarded-For', forwardedFor)
        .set(TRUSTED_CLIENT_IP_HEADER, clientIp)
        .set(TRUSTED_PROXY_TIMESTAMP_HEADER, timestamp)
        .set(TRUSTED_PROXY_SIGNATURE_HEADER, signature)
        .send({ tablePublicId: guestPrincipal.tablePublicId, joinCode: '482193' });
    };

    await send('203.0.113.10', 'join-one', '198.51.100.250').expect(200);
    await send('203.0.113.11', 'join-two', '198.51.100.251').expect(200);
    const sourceIps = join.mock.calls.map(([input]) => (input as { sourceIp: string }).sourceIp);
    expect(sourceIps).toEqual(['203.0.113.10', '203.0.113.11']);

    await request(server)
      .post(pathname)
      .set('Idempotency-Key', 'spoofed')
      .set('X-CSRF-Token', 'guest-csrf')
      .set('X-Forwarded-For', '192.0.2.99')
      .send({ tablePublicId: guestPrincipal.tablePublicId, joinCode: '482193' })
      .expect(403);
    expect(join).toHaveBeenCalledTimes(2);
  });
});
