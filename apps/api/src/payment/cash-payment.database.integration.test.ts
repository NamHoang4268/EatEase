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
import { OrderPersistence } from '../ordering/order-persistence.js';
import { CashPaymentService } from './cash-payment.service.js';
import type { CashPaymentResult } from './cash-payment.contract.js';

const databaseUrl = new URL(process.env.DATABASE_URL ?? 'http://invalid');
if (
  !['localhost', '127.0.0.1', '[::1]'].includes(databaseUrl.hostname) ||
  (databaseUrl.pathname !== '/eatease_m2_test' && process.env.CI !== 'true')
)
  throw new Error('M4.3 requires isolated local eatease_m2_test or ephemeral local CI.');
process.env.NODE_ENV = 'test';
process.env.TRUSTED_WEB_ORIGINS = 'http://localhost:3000';
process.env.OUTBOX_PUBLISHER_ENABLED = 'false';
const origin = 'http://localhost:3000';

describe('M4.3 atomic cash settlement on PostgreSQL', () => {
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
    const identity = await prisma.$queryRaw<Array<{ database: string; address: string }>>`
      SELECT current_database() AS "database", inet_server_addr()::text AS "address"`;
    if (identity[0]?.database !== databaseUrl.pathname.slice(1) || !identity[0]?.address)
      throw new Error('M4.3 database identity mismatch before writes.');
  });

  // Append-only financial fixtures use unique, test-owned scope. Never reset/delete shared data.
  afterAll(async () => {
    if (app) await app.close();
  });

  async function fixture(amount = 48_000n, checkout = true) {
    const restaurantId = randomUUID(),
      locationId = randomUUID();
    const scope = { restaurantId, locationId };
    await prisma.restaurant.create({ data: { id: restaurantId, name: 'M4.3 cash synthetic' } });
    await prisma.location.create({
      data: { id: locationId, restaurantId, code: 'M43', name: 'Cash fixture', isActive: true },
    });
    const user = await prisma.staffUser.create({
      data: {
        email: `m43-${randomUUID()}@example.test`,
        name: 'M43 staff',
        passwordHash: 'scrypt$fixture',
      },
    });
    const member = await prisma.staffMembership.create({
      data: { ...scope, staffUserId: user.id },
    });
    const role = await prisma.role.create({
      data: { restaurantId, code: 'M43', name: 'Cashier fixture' },
    });
    for (const code of [
      'payment.cash_record',
      'bill.checkout',
      'bill.read',
      'table.session.read',
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
      data: { restaurantId, roleId: role.id, membershipId: member.id },
    });
    const token = randomUUID(),
      csrf = randomUUID();
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
    const guestToken = randomUUID();
    const guest = await prisma.guestSession.create({
      data: {
        ...scope,
        tableId: table.id,
        tokenHash: hashToken(guestToken),
        csrfTokenHash: hashToken(randomUUID()),
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
      data: { ...scope, name: 'Cash fixture', displayOrder: 0 },
    });
    const menu = await prisma.menuItem.create({
      data: {
        ...scope,
        categoryId: category.id,
        name: 'Immutable dish',
        priceAmount: amount,
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
    const submitted = await persistence.persist(command);
    await prisma.orderItem.update({
      where: { id: submitted.order.items[0]!.id },
      data: { status: 'SERVED', version: 1 },
    });
    const f = {
      ...scope,
      token,
      csrf,
      guestToken,
      guestId: guest.id,
      sessionId: session.id,
      billId: bill.id,
      tableId: table.id,
      memberId: member.id,
      roleId: role.id,
      staffId: staff.id,
      command,
    };
    if (checkout)
      await send(f, 'checkout', { expectedSessionVersion: 0, expectedBillVersion: 1 }).expect(200);
    return f;
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  const versions = { expectedSessionVersion: 1, expectedBillVersion: 2 };
  function send(f: Fixture, action = 'cash-payment', body: object = versions, key = randomUUID()) {
    return request(server)
      .post(`/api/v1/staff/table-sessions/${f.sessionId}/${action}`)
      .set('Cookie', `eatease_staff_session=${f.token}`)
      .set('Origin', origin)
      .set('X-CSRF-Token', f.csrf)
      .set('Idempotency-Key', key)
      .send(body);
  }
  const result = (response: { body: unknown }) =>
    (response.body as { data: CashPaymentResult }).data;
  const code = (response: { body: unknown }) =>
    (response.body as { error: { code: string } }).error.code;
  async function records(f: Fixture) {
    return {
      payments: await prisma.payment.findMany({ where: { billId: f.billId } }),
      settlements: await prisma.settlement.findMany({ where: { billId: f.billId } }),
      audits: await prisma.auditLog.findMany({
        where: { resourceId: f.billId, action: 'CASH_PAYMENT_SETTLED' },
      }),
      events: await prisma.outboxEvent.findMany({
        where: { aggregateId: f.billId, eventType: 'bill.updated' },
        orderBy: { id: 'asc' },
      }),
      results: await prisma.idempotencyRecord.findMany({
        where: { resourceId: f.sessionId, operation: 'RECORD_CASH_PAYMENT' },
      }),
    };
  }
  async function history(f: Fixture) {
    return {
      session: await prisma.tableSession.findUniqueOrThrow({ where: { id: f.sessionId } }),
      table: await prisma.restaurantTable.findUniqueOrThrow({ where: { id: f.tableId } }),
      orders: await prisma.order.findMany({ where: { tableSessionId: f.sessionId } }),
      items: await prisma.orderItem.findMany({ where: { billId: f.billId } }),
      lines: await prisma.billLine.findMany({ where: { billId: f.billId } }),
      adjustments: await prisma.billAdjustment.findMany({ where: { billId: f.billId } }),
      guests: await prisma.guestSession.findMany({ where: { tableSessionId: f.sessionId } }),
    };
  }

  it('settles the exact positive BIGINT balance atomically and preserves session/table and immutable history', async () => {
    const amount = 9_007_199_254_740_993n;
    const f = await fixture(amount),
      beforeHistory = await history(f),
      before = await records(f);
    const response = await send(f).expect(200).expect('Cache-Control', 'no-store');
    const data = result(response);
    expect(data.session).toEqual({ id: f.sessionId, status: 'CHECKOUT_LOCKED', version: 1 });
    expect(data.bill).toEqual({
      id: f.billId,
      status: 'SETTLED',
      version: 3,
      totalAmount: amount.toString(),
      paidAmount: amount.toString(),
      balanceAmount: '0',
    });
    expect(data.payment).toMatchObject({
      method: 'CASH',
      status: 'SUCCEEDED',
      amount: amount.toString(),
    });
    const after = await records(f);
    expect(after.payments).toHaveLength(1);
    expect(after.payments[0]).toMatchObject({
      restaurantId: f.restaurantId,
      locationId: f.locationId,
      amount,
      recordedByMembershipId: f.memberId,
    });
    expect(after.settlements).toHaveLength(1);
    expect(after.settlements[0]).toMatchObject({
      settledAmount: amount,
      createdByMembershipId: f.memberId,
    });
    expect(after.audits).toHaveLength(1);
    expect(after.audits[0]).toMatchObject({
      actorId: f.memberId,
      resourceType: 'Bill',
      metadata: expect.objectContaining({
        paymentId: data.payment!.id,
        settlementId: data.settlement.id,
      }) as unknown,
    });
    expect(after.events).toHaveLength(before.events.length + 1);
    const event = after.events.find(
      (event) => !before.events.some((previous) => previous.id === event.id),
    );
    expect(event).toMatchObject({
      restaurantId: f.restaurantId,
      locationId: f.locationId,
      payload: expect.objectContaining({
        id: f.billId,
        tableSessionId: f.sessionId,
        status: 'SETTLED',
        version: 3,
      }) as unknown,
    });
    expect(after.results).toHaveLength(1);
    expect(after.results[0]?.responseBody).toEqual(data);
    expect(await history(f)).toEqual(beforeHistory);
    await request(server)
      .get(`/api/v1/staff/table-sessions/${f.sessionId}/bill`)
      .set('Cookie', `eatease_staff_session=${f.token}`)
      .expect(200);
  });

  it('settles a nonempty zero-balance Bill without Payment and blocks resume', async () => {
    const f = await fixture(0n),
      beforeHistory = await history(f);
    const response = await send(f).expect(200);
    expect(result(response)).toMatchObject({
      payment: null,
      settlement: { settledAmount: '0' },
      bill: { status: 'SETTLED', paidAmount: '0', balanceAmount: '0' },
    });
    expect((await records(f)).payments).toHaveLength(0);
    expect((await records(f)).settlements).toHaveLength(1);
    expect(await history(f)).toEqual(beforeHistory);
    await send(f, 'resume-ordering', { ...versions, expectedBillVersion: 3 }).expect(409);
  });

  it.each(['session', 'bill'] as const)(
    'rejects stale %s version without financial writes',
    async (target) => {
      const f = await fixture(),
        before = await records(f);
      const stale =
        target === 'session'
          ? { ...versions, expectedSessionVersion: 0 }
          : { ...versions, expectedBillVersion: 1 };
      expect(code(await send(f, 'cash-payment', stale).expect(409))).toBe(
        'CASH_PAYMENT_VERSION_CONFLICT',
      );
      expect(await records(f)).toEqual(before);
    },
  );

  it('serializes same-key retries, returns the original response after a lost response, and rejects conflicting keys', async () => {
    const f = await fixture(),
      key = randomUUID();
    const responses = await Promise.all([
      send(f, 'cash-payment', versions, key),
      send(f, 'cash-payment', versions, key),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect(responses[0].body).toEqual(responses[1].body);
    const beforeReplay = await records(f);
    expect((await send(f, 'cash-payment', versions, key).expect(200)).body).toEqual(
      responses[0].body,
    );
    expect(await records(f)).toEqual(beforeReplay);
    expect(
      code(await send(f, 'cash-payment', { ...versions, expectedBillVersion: 3 }, key).expect(409)),
    ).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(
      code(await send(f, 'cash-payment', { ...versions, expectedBillVersion: 3 }).expect(409)),
    ).toBe('CASH_PAYMENT_STATE_CONFLICT');
    expect(beforeReplay.payments).toHaveLength(1);
    expect(beforeReplay.settlements).toHaveLength(1);
    expect(beforeReplay.audits).toHaveLength(1);
  });

  it('allows only one different-key concurrent settlement', async () => {
    const f = await fixture();
    const responses = await Promise.all([send(f), send(f)]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const stored = await records(f);
    expect(stored.payments).toHaveLength(1);
    expect(stored.settlements).toHaveLength(1);
    expect(stored.audits).toHaveLength(1);
    expect(stored.results).toHaveLength(1);
  });

  it('serializes settlement against resume and cannot accept new orders while settled/locked', async () => {
    const f = await fixture();
    const [cash, resume] = await Promise.all([send(f), send(f, 'resume-ordering')]);
    expect([cash.status, resume.status].sort()).toEqual([200, 409]);
    const bill = await prisma.bill.findUniqueOrThrow({ where: { id: f.billId } });
    const session = await prisma.tableSession.findUniqueOrThrow({ where: { id: f.sessionId } });
    if (cash.status === 200) {
      expect([bill.status, session.status]).toEqual(['SETTLED', 'CHECKOUT_LOCKED']);
      await expect(
        persistence.persist({ ...f.command, idempotencyKey: randomUUID() }),
      ).rejects.toMatchObject({ response: { code: 'TABLE_SESSION_NOT_ORDERABLE' } });
    } else {
      expect([bill.status, session.status]).toEqual(['OPEN', 'ACTIVE']);
      expect((await records(f)).settlements).toHaveLength(0);
    }
  });

  it('requires staff cookie, trusted Origin, CSRF and strict input; Guest credentials cannot record cash', async () => {
    const f = await fixture(),
      before = await records(f);
    await send(f).unset('Cookie').expect(401);
    await send(f).set('Cookie', `eatease_guest_session=${f.guestToken}`).expect(401);
    await send(f).unset('Origin').expect(403);
    await send(f).set('Origin', 'https://untrusted.example').expect(403);
    await send(f).unset('X-CSRF-Token').expect(403);
    await send(f).set('X-CSRF-Token', 'invalid').expect(403);
    await send(f).unset('Idempotency-Key').expect(400);
    await send(f, 'cash-payment', { ...versions, amount: '1' }).expect(400);
    expect(await records(f)).toEqual(before);
  });

  it('rejects a concurrent new SubmitOrder while the locked Bill is being settled', async () => {
    const f = await fixture();
    const beforeHistory = await history(f);
    const [cash, order] = await Promise.all([
      send(f).expect(200),
      persistence.persist({ ...f.command, idempotencyKey: randomUUID() }).then(
        () => 'unexpected submission',
        (error: unknown) => error,
      ),
    ]);
    expect(result(cash).bill.status).toBe('SETTLED');
    expect(order).toMatchObject({ response: { code: 'TABLE_SESSION_NOT_ORDERABLE' } });
    expect(await history(f)).toEqual(beforeHistory);
  });

  it('denies cross-restaurant and same-restaurant wrong-location targets', async () => {
    const f = await fixture(),
      other = await fixture();
    expect(code(await send({ ...f, sessionId: other.sessionId }).expect(403))).toBe(
      'CASH_PAYMENT_SCOPE_DENIED',
    );
    const secondLocation = await prisma.location.create({
      data: { restaurantId: other.restaurantId, code: 'OTHER', name: 'Other', isActive: false },
    });
    const principal = await app.get(StaffSessionService).authenticate(other.token);
    if (!principal) throw new Error('Missing fixture principal');
    await expect(
      app
        .get(CashPaymentService)
        .record(
          { ...principal, locationId: secondLocation.id },
          { ...versions, tableSessionId: other.sessionId, idempotencyKey: randomUUID() },
        ),
    ).rejects.toMatchObject({ status: 403 });
    expect((await records(f)).payments).toHaveLength(0);
    expect((await records(other)).payments).toHaveLength(0);
  });

  it('denies a revoked permission both at the endpoint and during transaction-time authorization', async () => {
    const f = await fixture();
    const principal = await app.get(StaffSessionService).authenticate(f.token);
    if (!principal) throw new Error('Missing fixture principal');
    const permission = await prisma.permission.findUniqueOrThrow({
      where: { code: 'payment.cash_record' },
    });
    await prisma.rolePermission.delete({
      where: { roleId_permissionId: { roleId: f.roleId, permissionId: permission.id } },
    });
    await send(f).expect(403);
    await expect(
      app.get(CashPaymentService).record(principal, {
        ...versions,
        tableSessionId: f.sessionId,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect((await records(f)).payments).toHaveLength(0);
  });

  it.each(['revoked', 'expired', 'membership'] as const)(
    'denies %s staff state, including previously authenticated principals',
    async (kind) => {
      const f = await fixture();
      const principal = await app.get(StaffSessionService).authenticate(f.token);
      if (!principal) throw new Error('Missing fixture principal');
      if (kind === 'revoked')
        await prisma.staffSession.update({
          where: { id: f.staffId },
          data: { revokedAt: new Date() },
        });
      if (kind === 'expired')
        await prisma.staffSession.update({
          where: { id: f.staffId },
          data: {
            createdAt: new Date(Date.now() - 60_000),
            expiresAt: new Date(Date.now() - 1_000),
          },
        });
      if (kind === 'membership')
        await prisma.staffMembership.update({
          where: { id: f.memberId },
          data: { status: 'REVOKED' },
        });
      await send(f).expect(401);
      await expect(
        app.get(CashPaymentService).record(principal, {
          ...versions,
          tableSessionId: f.sessionId,
          idempotencyKey: randomUUID(),
        }),
      ).rejects.toMatchObject({ status: 401 });
      expect((await records(f)).settlements).toHaveLength(0);
    },
  );

  it('does not replay cash results after authorization is revoked', async () => {
    const f = await fixture(),
      key = randomUUID();
    await send(f, 'cash-payment', versions, key).expect(200);
    await prisma.staffSession.update({ where: { id: f.staffId }, data: { revokedAt: new Date() } });
    await send(f, 'cash-payment', versions, key).expect(401);
    expect((await records(f)).payments).toHaveLength(1);
  });

  it.each(['payment', 'settlement'] as const)(
    'blocks settlement and resume with a pre-existing %s even when paidAmount is zero',
    async (kind) => {
      const f = await fixture(kind === 'settlement' ? 0n : 48_000n);
      if (kind === 'payment')
        await prisma.payment.create({
          data: {
            restaurantId: f.restaurantId,
            locationId: f.locationId,
            billId: f.billId,
            amount: 48_000n,
            recordedByMembershipId: f.memberId,
          },
        });
      else
        await prisma.settlement.create({
          data: {
            restaurantId: f.restaurantId,
            locationId: f.locationId,
            billId: f.billId,
            settledAmount: 0n,
            createdByMembershipId: f.memberId,
          },
        });
      const before = await records(f);
      expect(code(await send(f).expect(409))).toBe('CASH_PAYMENT_STATE_CONFLICT');
      expect(code(await send(f, 'resume-ordering').expect(409))).toBe('CHECKOUT_PAYMENT_RECORDED');
      expect(await records(f)).toEqual(before);
      expect((await history(f)).session.status).toBe('CHECKOUT_LOCKED');
    },
  );

  it.each(['auditLog', 'outboxEvent', 'idempotencyRecord'] as const)(
    'rolls back all financial writes after %s failure and permits retry with the same key',
    async (delegate) => {
      const f = await fixture(),
        beforeRecords = await records(f),
        beforeHistory = await history(f);
      const bill = await prisma.bill.findUniqueOrThrow({ where: { id: f.billId } }),
        key = randomUUID();
      const original = prisma.$transaction.bind(prisma);
      const spy = vi
        .spyOn(prisma, '$transaction')
        .mockImplementationOnce((fn: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
          original(async (tx) =>
            fn(
              new Proxy(tx, {
                get(target, property) {
                  if (property === delegate)
                    return {
                      ...target[delegate],
                      create: () => Promise.reject(new Error('M43 injected failure')),
                    };
                  return Reflect.get(target, property) as unknown;
                },
              }),
            ),
          ),
        );
      try {
        await send(f, 'cash-payment', versions, key).expect(500);
      } finally {
        spy.mockRestore();
      }
      expect(await records(f)).toEqual(beforeRecords);
      expect(await history(f)).toEqual(beforeHistory);
      expect(await prisma.bill.findUniqueOrThrow({ where: { id: f.billId } })).toEqual(bill);
      await send(f, 'cash-payment', versions, key).expect(200);
    },
  );

  it('rejects an ACTIVE/OPEN pair until checkout succeeds', async () => {
    const f = await fixture(48_000n, false);
    expect(
      code(
        await send(f, 'cash-payment', { expectedSessionVersion: 0, expectedBillVersion: 1 }).expect(
          409,
        ),
      ),
    ).toBe('CASH_PAYMENT_STATE_CONFLICT');
    expect((await records(f)).settlements).toHaveLength(0);
  });
});
