import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../app.module.js';
import { FoundationExceptionFilter } from '../common/filters/foundation-exception.filter.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { hashToken } from '../staff-auth/auth.crypto.js';
import { StaffSessionService } from '../staff-auth/staff-session.service.js';
import { OrderPersistence } from './order-persistence.js';
import { CheckoutService } from './checkout.service.js';

const target = new URL(process.env.DATABASE_URL ?? 'http://invalid');
if (
  !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
  (target.pathname !== '/eatease_m2_test' && process.env.CI !== 'true')
)
  throw new Error('M4.1 requires isolated local eatease_m2_test or ephemeral local CI.');
process.env.NODE_ENV = 'test';
process.env.TRUSTED_WEB_ORIGINS = 'http://localhost:3000';
const origin = 'http://localhost:3000';

describe('M4.1 atomic checkout on PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Server;
  let persistence: OrderPersistence;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new FoundationExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    server = app.getHttpServer() as Server;
    persistence = app.get(OrderPersistence);
    const identity = await prisma.$queryRaw<
      Array<{ database: string; address: string }>
    >`SELECT current_database() AS "database", inet_server_addr()::text AS "address"`;
    if (identity[0]?.database !== target.pathname.slice(1) || !identity[0]?.address)
      throw new Error('M4.1 database identity mismatch before writes.');
  });
  afterAll(async () => {
    if (app) await app.close();
  });
  // Immutable financial fixture history is retained under random, test-owned restaurant IDs.
  async function fixture(
    empty = false,
    state: 'NEW' | 'PREPARING' | 'READY' | 'SERVED' = 'SERVED',
  ) {
    const token = randomUUID(),
      csrf = randomUUID(),
      guestToken = randomUUID(),
      guestCsrf = randomUUID();
    const restaurant = await prisma.restaurant.create({ data: { name: 'M4.1 synthetic' } });
    const scope = { restaurantId: restaurant.id, locationId: randomUUID() };
    await prisma.location.create({
      data: {
        id: scope.locationId,
        restaurantId: restaurant.id,
        code: 'M41',
        name: 'Checkout test',
        isActive: true,
      },
    });
    const user = await prisma.staffUser.create({
      data: {
        email: `m41-${randomUUID()}@example.test`,
        name: 'M41 staff',
        passwordHash: 'scrypt$fixture',
      },
    });
    const member = await prisma.staffMembership.create({
      data: { ...scope, staffUserId: user.id },
    });
    const role = await prisma.role.create({
      data: { restaurantId: restaurant.id, code: 'M41', name: 'Checkout fixture' },
    });
    for (const code of [
      'bill.checkout',
      'bill.read',
      'bill.adjust',
      'table.session.read',
      'order.create_for_table',
    ]) {
      const permission = await prisma.permission.upsert({
        where: { code },
        create: { code },
        update: {},
      });
      await prisma.rolePermission.create({
        data: { roleId: role.id, permissionId: permission.id },
      });
    }
    await prisma.membershipRole.create({
      data: { restaurantId: restaurant.id, roleId: role.id, membershipId: member.id },
    });
    const staff = await prisma.staffSession.create({
      data: {
        staffUserId: user.id,
        membershipId: member.id,
        tokenHash: hashToken(token),
        csrfTokenHash: hashToken(csrf),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    const table = await prisma.restaurantTable.create({
      data: { ...scope, code: 'A01', capacity: 4, physicalStatus: 'OCCUPIED' },
    });
    const guest = await prisma.guestSession.create({
      data: {
        ...scope,
        tableId: table.id,
        tokenHash: hashToken(guestToken),
        csrfTokenHash: hashToken(guestCsrf),
        idleExpiresAt: new Date(Date.now() + 1_800_000),
        absoluteExpiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    const activation = await prisma.activationRequest.create({
      data: {
        ...scope,
        tableId: table.id,
        requesterGuestSessionId: guest.id,
        status: 'APPROVED',
        handledByMembershipId: member.id,
        handledAt: new Date(),
        version: 1,
        expiresAt: new Date(Date.now() + 300_000),
      },
    });
    const session = await prisma.tableSession.create({
      data: {
        ...scope,
        tableId: table.id,
        activationRequestId: activation.id,
        activatedByMembershipId: member.id,
      },
    });
    const bill = await prisma.bill.create({ data: { ...scope, tableSessionId: session.id } });
    await prisma.guestSession.update({
      where: { id: guest.id },
      data: { tableSessionId: session.id, accessLevel: 'ORDER_ENABLED' },
    });
    const category = await prisma.menuCategory.create({
      data: { ...scope, name: 'M41', displayOrder: 0 },
    });
    const menu = await prisma.menuItem.create({
      data: {
        ...scope,
        categoryId: category.id,
        name: 'Immutable M41 dish',
        priceAmount: 42_000n,
        fulfillmentStation: 'DIRECT',
      },
    });
    const command = {
      ...scope,
      tableSessionId: session.id,
      actor: { type: 'GUEST_SESSION' as const, id: guest.id },
      idempotencyKey: randomUUID(),
      idempotencyExpiresAt: new Date(Date.now() + 600_000),
      items: [{ menuItemId: menu.id, quantity: 1 }],
    };
    if (!empty) {
      const submitted = await persistence.persist(command);
      await prisma.orderItem.update({
        where: { id: submitted.order.items[0]!.id },
        data: { status: state, version: state === 'NEW' ? 0 : 1 },
      });
    }
    return {
      ...scope,
      token,
      csrf,
      guestToken,
      guestCsrf,
      guestId: guest.id,
      sessionId: session.id,
      billId: bill.id,
      staffId: staff.id,
      memberId: member.id,
      roleId: role.id,
      tableId: table.id,
      command,
    };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  const body = (session = 0, bill = 1) => ({
    expectedSessionVersion: session,
    expectedBillVersion: bill,
  });
  function send(
    f: Fixture,
    action: 'checkout' | 'resume-ordering' = 'checkout',
    versions = body(),
    key = randomUUID(),
    guest = false,
  ) {
    return request(server)
      .post(
        guest
          ? '/api/v1/table-sessions/current/checkout'
          : `/api/v1/staff/table-sessions/${f.sessionId}/${action}`,
      )
      .set(
        'Cookie',
        guest ? `eatease_guest_session=${f.guestToken}` : `eatease_staff_session=${f.token}`,
      )
      .set('Origin', origin)
      .set('X-CSRF-Token', guest ? f.guestCsrf : f.csrf)
      .set('Idempotency-Key', key)
      .send(versions);
  }
  const code = (response: { body: unknown }) =>
    (response.body as { error: { code: string } }).error.code;
  async function history(f: Fixture) {
    return {
      orders: await prisma.order.findMany({ where: { restaurantId: f.restaurantId } }),
      items: await prisma.orderItem.findMany({ where: { restaurantId: f.restaurantId } }),
      lines: await prisma.billLine.findMany({ where: { billId: f.billId } }),
      adjustments: await prisma.billAdjustment.findMany({ where: { billId: f.billId } }),
    };
  }

  it('atomically checks out as Guest, keeps authorized reads and resumes as staff without financial/history changes', async () => {
    const f = await fixture();
    const before = await history(f);
    const billBefore = await prisma.bill.findUniqueOrThrow({ where: { id: f.billId } });
    await send(f, 'checkout', body(), randomUUID(), true)
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(
      await prisma.tableSession.findUniqueOrThrow({ where: { id: f.sessionId } }),
    ).toMatchObject({
      status: 'CHECKOUT_LOCKED',
      version: 1,
      checkoutLockedAt: expect.any(Date) as unknown,
    });
    expect(await prisma.bill.findUniqueOrThrow({ where: { id: f.billId } })).toEqual({
      ...billBefore,
      status: 'PAYMENT_PENDING',
      version: 2,
    });
    for (const guest of [true, false]) {
      const response = await request(server)
        .get(
          guest
            ? '/api/v1/table-sessions/current'
            : `/api/v1/staff/table-sessions/${f.sessionId}/bill`,
        )
        .set(
          'Cookie',
          guest ? `eatease_guest_session=${f.guestToken}` : `eatease_staff_session=${f.token}`,
        )
        .expect(200);
      expect((response.body as { data: { session: { status: string } } }).data.session.status).toBe(
        'CHECKOUT_LOCKED',
      );
    }
    const list = await request(server)
      .get('/api/v1/staff/table-sessions?status=ACTIVE,CHECKOUT_LOCKED')
      .set('Cookie', `eatease_staff_session=${f.token}`)
      .expect(200);
    expect((list.body as { data: Array<{ id: string; status: string }> }).data).toContainEqual(
      expect.objectContaining({ id: f.sessionId, status: 'CHECKOUT_LOCKED' }),
    );
    const activeOnly = await request(server)
      .get('/api/v1/staff/table-sessions?status=ACTIVE')
      .set('Cookie', `eatease_staff_session=${f.token}`)
      .expect(200);
    expect(
      (activeOnly.body as { data: Array<{ id: string }> }).data.some(
        (session) => session.id === f.sessionId,
      ),
    ).toBe(false);
    await expect(
      persistence.persist({ ...f.command, idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ response: { code: 'TABLE_SESSION_NOT_ORDERABLE' } });
    await send(f, 'resume-ordering', body(1, 2)).expect(200);
    expect(
      await prisma.tableSession.findUniqueOrThrow({ where: { id: f.sessionId } }),
    ).toMatchObject({ status: 'ACTIVE', version: 2, checkoutLockedAt: null });
    expect(await prisma.bill.findUniqueOrThrow({ where: { id: f.billId } })).toEqual({
      ...billBefore,
      version: 3,
    });
    expect(await history(f)).toEqual(before);
    expect(
      await prisma.restaurantTable.findUniqueOrThrow({ where: { id: f.tableId } }),
    ).toMatchObject({ physicalStatus: 'OCCUPIED', version: 0 });
    await persistence.persist({ ...f.command, idempotencyKey: randomUUID() });
  });

  it.each(['NEW', 'PREPARING', 'READY'] as const)(
    'rejects non-terminal %s without writes',
    async (state) => {
      const f = await fixture(false, state);
      expect(code(await send(f).expect(409))).toBe('CHECKOUT_ITEMS_NOT_TERMINAL');
      expect(await prisma.auditLog.count({ where: { restaurantId: f.restaurantId } })).toBe(0);
    },
  );

  it('rejects empty sessions and pending cancellation requests', async () => {
    const empty = await fixture(true);
    expect(code(await send(empty, 'checkout', body(0, 0)).expect(409))).toBe(
      'CHECKOUT_EMPTY_SESSION',
    );
    const f = await fixture();
    const item = await prisma.orderItem.findFirstOrThrow({ where: { billId: f.billId } });
    await prisma.cancellationRequest.create({
      data: {
        restaurantId: f.restaurantId,
        locationId: f.locationId,
        tableSessionId: f.sessionId,
        billId: f.billId,
        orderItemId: item.id,
        source: 'GUEST_REQUEST',
        status: 'PENDING_WAITER',
        requesterGuestSessionId: f.guestId,
        requestReason: 'Pending test',
      },
    });
    expect(code(await send(f).expect(409))).toBe('CHECKOUT_CANCELLATION_PENDING');
  });

  it('accepts a nonempty fully waived Bill with preserved ordering history and REJECTED terminal history', async () => {
    const f = await fixture(false, 'READY');
    const item = await prisma.orderItem.findFirstOrThrow({ where: { billId: f.billId } });
    await request(server)
      .post(`/api/v1/staff/fulfillment/items/${item.id}/manager-correction`)
      .set('Cookie', `eatease_staff_session=${f.token}`)
      .set('Origin', origin)
      .set('X-CSRF-Token', f.csrf)
      .set('Idempotency-Key', randomUUID())
      .send({ expectedVersion: 1, reason: 'Full waiver checkout fixture' })
      .expect(200);
    const before = await history(f);
    await send(f, 'checkout', body(0, 2)).expect(200);
    expect(await prisma.bill.findUniqueOrThrow({ where: { id: f.billId } })).toMatchObject({
      totalAmount: 0n,
      balanceAmount: 0n,
      status: 'PAYMENT_PENDING',
    });
    expect(await history(f)).toEqual(before);
    const rejected = await fixture(false, 'NEW');
    await prisma.orderItem.updateMany({
      where: { billId: rejected.billId },
      data: { status: 'REJECTED' },
    });
    await send(rejected).expect(200);
  });

  it('serializes identical retries and replays historical results after resume without duplicate events', async () => {
    const f = await fixture(),
      key = randomUUID();
    const [a, b] = await Promise.all([
      send(f, 'checkout', body(), key),
      send(f, 'checkout', body(), key),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body).toEqual(b.body);
    expect(code(await send(f, 'checkout', body(1, 2), key).expect(409))).toBe(
      'IDEMPOTENCY_KEY_REUSED',
    );
    const resumeKey = randomUUID();
    const resumed = await send(f, 'resume-ordering', body(1, 2), resumeKey).expect(200);
    expect((await send(f, 'resume-ordering', body(1, 2), resumeKey).expect(200)).body).toEqual(
      resumed.body,
    );
    expect((await send(f, 'checkout', body(), key).expect(200)).body).toEqual(a.body);
    expect(await prisma.auditLog.count({ where: { resourceId: f.sessionId } })).toBe(2);
    expect(
      await prisma.outboxEvent.count({
        where: { aggregateId: f.sessionId, eventType: 'table.session.updated' },
      }),
    ).toBe(2);
    const billEvents = await prisma.outboxEvent.findMany({
      where: { aggregateId: f.billId, eventType: 'bill.updated' },
    });
    expect(billEvents).toHaveLength(3); // one submission plus one per successful lifecycle command
    expect(await prisma.idempotencyRecord.count({ where: { resourceId: f.sessionId } })).toBe(2);
  });

  it('rejects stale versions, wrong state and distinct-key concurrent checkout', async () => {
    const f = await fixture();
    expect(code(await send(f, 'checkout', body(1, 1)).expect(409))).toBe(
      'CHECKOUT_VERSION_CONFLICT',
    );
    expect(code(await send(f, 'resume-ordering').expect(409))).toBe('CHECKOUT_STATE_CONFLICT');
    const replies = await Promise.all([send(f), send(f)]);
    expect(replies.map((reply) => reply.status).sort()).toEqual([200, 409]);
    expect(await prisma.auditLog.count({ where: { resourceId: f.sessionId } })).toBe(1);
  });

  it('serializes checkout against concurrent SubmitOrder without allowing an unchecked new item', async () => {
    const f = await fixture();
    const [checkout, order] = await Promise.allSettled([
      send(f).then((response) => response),
      persistence.persist({ ...f.command, idempotencyKey: randomUUID() }),
    ]);
    expect(checkout.status).toBe('fulfilled');
    if (checkout.status !== 'fulfilled') throw checkout.reason;
    const session = await prisma.tableSession.findUniqueOrThrow({ where: { id: f.sessionId } });
    if (order.status === 'fulfilled') {
      expect(checkout.value.status).toBe(409);
      expect(session.status).toBe('ACTIVE');
    } else {
      expect(order.reason).toMatchObject({ response: { code: 'TABLE_SESSION_NOT_ORDERABLE' } });
      expect(checkout.value.status).toBe(200);
      expect(session.status).toBe('CHECKOUT_LOCKED');
    }
  });

  it('enforces Guest ownership and staff scope, permission, Origin, CSRF and active session', async () => {
    const f = await fixture(),
      other = await fixture();
    await send(f).unset('Cookie').expect(401);
    await send(f).unset('Origin').expect(403);
    await send(f).set('Origin', 'https://untrusted.example').expect(403);
    await send(f).unset('X-CSRF-Token').expect(403);
    await send(f, 'checkout', body(), randomUUID(), true).unset('X-CSRF-Token').expect(403);
    await send(f, 'checkout', body(), randomUUID(), true).unset('Origin').expect(403);
    await send({ ...f, sessionId: other.sessionId }).expect(403);
    // Guest target is always its own session; attempts to supply another ID in the body fail validation.
    await send(f, 'checkout', body(), randomUUID(), true)
      .send({ ...body(), tableSessionId: other.sessionId })
      .expect(400);
    await request(server)
      .post(`/api/v1/staff/table-sessions/${f.sessionId}/resume-ordering`)
      .set('Cookie', `eatease_guest_session=${f.guestToken}`)
      .set('Origin', origin)
      .set('X-CSRF-Token', f.guestCsrf)
      .send(body())
      .expect(401);
    const permission = await prisma.permission.findUniqueOrThrow({
      where: { code: 'bill.checkout' },
    });
    const principal = await app.get(StaffSessionService).authenticate(f.token);
    if (!principal) throw new Error('Missing fixture principal');
    await prisma.rolePermission.delete({
      where: { roleId_permissionId: { roleId: f.roleId, permissionId: permission.id } },
    });
    await send(f).expect(403);
    await expect(
      app.get(CheckoutService).checkoutStaff(principal, {
        ...body(),
        tableSessionId: f.sessionId,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 403 });
    await prisma.staffSession.update({
      where: { id: other.staffId },
      data: { revokedAt: new Date() },
    });
    await send(other).expect(401);
    await prisma.guestSession.update({ where: { id: f.guestId }, data: { revokedAt: new Date() } });
    await send(f, 'checkout', body(), randomUUID(), true).expect(401);
  });

  it('rolls back both transitions, audit and outbox after a late persistence failure', async () => {
    const f = await fixture();
    const before = await prisma.bill.findUniqueOrThrow({ where: { id: f.billId } });
    const original = prisma.$transaction.bind(prisma);
    const spy = vi
      .spyOn(prisma, '$transaction')
      .mockImplementationOnce((fn: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        original(async (tx) =>
          fn(
            new Proxy(tx, {
              get(target, property) {
                if (property === 'idempotencyRecord')
                  return {
                    ...target.idempotencyRecord,
                    create: () => Promise.reject(new Error('M41 late failure')),
                  };
                return Reflect.get(target, property) as unknown;
              },
            }),
          ),
        ),
      );
    try {
      await send(f).expect(500);
    } finally {
      spy.mockRestore();
    }
    expect(await prisma.bill.findUniqueOrThrow({ where: { id: f.billId } })).toEqual(before);
    expect(
      await prisma.tableSession.findUniqueOrThrow({ where: { id: f.sessionId } }),
    ).toMatchObject({ status: 'ACTIVE', version: 0, checkoutLockedAt: null });
    expect(await prisma.auditLog.count({ where: { resourceId: f.sessionId } })).toBe(0);
    expect(await prisma.outboxEvent.count({ where: { aggregateId: f.sessionId } })).toBe(0);
    expect(await prisma.idempotencyRecord.count({ where: { resourceId: f.sessionId } })).toBe(0);
  });

  it('revalidates expiry and membership changes and denies browse-only Guest checkout', async () => {
    const f = await fixture();
    await prisma.staffSession.update({
      where: { id: f.staffId },
      data: {
        createdAt: new Date(Date.now() - 60_000),
        expiresAt: new Date(Date.now() - 1_000),
      },
    });
    await send(f).expect(401);
    const other = await fixture();
    await prisma.staffMembership.update({
      where: { id: other.memberId },
      data: { status: 'REVOKED' },
    });
    await send(other).expect(401);
    const browse = await fixture();
    await prisma.guestSession.update({
      where: { id: browse.guestId },
      data: { accessLevel: 'BROWSE_ONLY' },
    });
    await send(browse, 'checkout', body(), randomUUID(), true).expect(403);
    expect(
      await prisma.auditLog.count({
        where: { restaurantId: { in: [f.restaurantId, other.restaurantId, browse.restaurantId] } },
      }),
    ).toBe(0);
  });

  it('rejects resume after recorded money or settled Bill', async () => {
    const f = await fixture();
    await send(f).expect(200);
    await prisma.bill.update({
      where: { id: f.billId },
      data: { paidAmount: 42_000n, balanceAmount: 0n },
    });
    expect(code(await send(f, 'resume-ordering', body(1, 2)).expect(409))).toBe(
      'CHECKOUT_PAYMENT_RECORDED',
    );
    await prisma.bill.update({ where: { id: f.billId }, data: { status: 'SETTLED' } });
    expect(code(await send(f, 'resume-ordering', body(1, 2)).expect(409))).toBe(
      'CHECKOUT_STATE_CONFLICT',
    );
  });
});
