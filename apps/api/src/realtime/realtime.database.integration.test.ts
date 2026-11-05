import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module.js';
import { PrismaService } from '../database/prisma.service.js';
import { FoundationExceptionFilter } from '../common/filters/foundation-exception.filter.js';
import { hashToken } from '../staff-auth/auth.crypto.js';
import { RealtimeService } from './realtime.service.js';
import { RealtimeTicketService } from './realtime-ticket.service.js';
import { OutboxStore } from './outbox.store.js';
import { OutboxPublisher } from './outbox-publisher.service.js';
import type { Prisma } from '../generated/prisma/client.js';

const rawUrl = process.env.DATABASE_URL;
if (!rawUrl) throw new Error('DATABASE_URL required for M2.11 integration tests');
const target = new URL(rawUrl);
if (
  !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
  (target.pathname !== '/eatease_m2_test' && process.env.CI !== 'true')
)
  throw new Error('M2.11 requires isolated local eatease_m2_test or ephemeral local CI');
process.env.NODE_ENV = 'test';
process.env.REALTIME_ENABLED = 'true';
process.env.OUTBOX_PUBLISHER_ENABLED = 'false';
process.env.REALTIME_PUBLIC_URL = 'http://localhost:3001';
process.env.TRUSTED_WEB_ORIGINS = 'http://localhost:3000';
const origin = 'http://localhost:3000';

describe('M2.11 real PostgreSQL leases, tickets and Socket.IO isolation', () => {
  let app: INestApplication, prisma: PrismaService, server: Server, endpoint: string;
  let store: OutboxStore, realtime: RealtimeService, tickets: RealtimeTicketService;
  const clients: Socket[] = [];
  const fixtureRoleIds: string[] = [];
  const createdPermissionIds = new Set<string>();

  async function scope() {
    const restaurant = await prisma.restaurant.create({ data: { name: 'M211 synthetic' } });
    const location = await prisma.location.create({
      data: { restaurantId: restaurant.id, code: 'M211', name: 'M211', isActive: true },
    });
    return { restaurantId: restaurant.id, locationId: location.id };
  }
  async function fixture() {
    const context = await scope();
    const user = await prisma.staffUser.create({
      data: {
        email: `m211-${randomUUID()}@example.test`,
        name: 'M211',
        passwordHash: 'scrypt$fixture',
      },
    });
    const membership = await prisma.staffMembership.create({
      data: { ...context, staffUserId: user.id },
    });
    const role = await prisma.role.create({
      data: { restaurantId: context.restaurantId, code: 'M211', name: 'M211' },
    });
    fixtureRoleIds.push(role.id);
    for (const code of [
      'fulfillment.read',
      'bill.read',
      'table.activation.read',
      'table.session.read',
    ]) {
      const candidateId = randomUUID();
      const permission = await prisma.permission.upsert({
        where: { code },
        create: { id: candidateId, code },
        update: {},
      });
      if (permission.id === candidateId) createdPermissionIds.add(candidateId);
      await prisma.rolePermission.create({
        data: { roleId: role.id, permissionId: permission.id },
      });
    }
    await prisma.membershipRole.create({
      data: { restaurantId: context.restaurantId, membershipId: membership.id, roleId: role.id },
    });
    const staffToken = randomUUID(),
      csrf = randomUUID(),
      guestToken = randomUUID();
    const staff = await prisma.staffSession.create({
      data: {
        staffUserId: user.id,
        membershipId: membership.id,
        tokenHash: hashToken(staffToken),
        csrfTokenHash: hashToken(csrf),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    const table = await prisma.restaurantTable.create({
      data: { ...context, code: 'A01', capacity: 4, physicalStatus: 'OCCUPIED' },
    });
    const guest = await prisma.guestSession.create({
      data: {
        ...context,
        tableId: table.id,
        tokenHash: hashToken(guestToken),
        csrfTokenHash: hashToken(csrf),
        idleExpiresAt: new Date(Date.now() + 1_800_000),
        absoluteExpiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    const activation = await prisma.activationRequest.create({
      data: {
        ...context,
        tableId: table.id,
        requesterGuestSessionId: guest.id,
        status: 'APPROVED',
        handledByMembershipId: membership.id,
        handledAt: new Date(),
        expiresAt: new Date(Date.now() + 300_000),
        version: 1,
      },
    });
    const session = await prisma.tableSession.create({
      data: {
        ...context,
        tableId: table.id,
        activationRequestId: activation.id,
        activatedByMembershipId: membership.id,
      },
    });
    await prisma.bill.create({ data: { ...context, tableSessionId: session.id } });
    await prisma.guestSession.update({
      where: { id: guest.id },
      data: { accessLevel: 'ORDER_ENABLED', tableSessionId: session.id },
    });
    return {
      ...context,
      tableId: table.id,
      sessionId: session.id,
      staffId: staff.id,
      guestId: guest.id,
      membershipId: membership.id,
      roleId: role.id,
      staffToken,
      guestToken,
      csrf,
    };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  let local: Fixture, foreign: Fixture;
  function issue(context: Fixture, audience = 'kitchen', actor = 'staff', tableSessionId?: string) {
    return request(server)
      .post(`/api/v1/${actor}/realtime/tickets`)
      .set('Origin', origin)
      .set(
        'Cookie',
        actor === 'staff'
          ? `eatease_staff_session=${context.staffToken}`
          : `eatease_guest_session=${context.guestToken}`,
      )
      .set('X-CSRF-Token', context.csrf)
      .send({ audience, ...(tableSessionId ? { tableSessionId } : {}) });
  }
  function connect(ticket: string, suppliedOrigin = origin) {
    return new Promise<Socket>((resolve, reject) => {
      const client = io(endpoint, {
        transports: ['websocket'],
        forceNew: true,
        reconnection: false,
        timeout: 2000,
        auth: { ticket },
        extraHeaders: { Origin: suppliedOrigin },
      });
      clients.push(client);
      client.once('connect', () => resolve(client));
      client.once('connect_error', reject);
    });
  }
  const tokenFrom = (response: { body: unknown }) =>
    (response.body as { data: { ticket: string } }).data.ticket;
  async function eventData(
    context: { restaurantId: string; locationId: string } = local,
  ): Promise<Prisma.OutboxEventUncheckedCreateInput & { occurredAt: Date }> {
    const id = randomUUID();
    const [clock] = await prisma.$queryRaw<Array<{ occurredAt: Date }>>`
      SELECT date_trunc('milliseconds', clock_timestamp()) AS "occurredAt"`;
    return {
      restaurantId: context.restaurantId,
      locationId: context.locationId,
      occurredAt: clock!.occurredAt,
      aggregateType: 'Bill',
      aggregateId: id,
      eventType: 'bill.updated',
      payload: { id, tableSessionId: local.sessionId, version: 1 },
    };
  }
  async function claimEvent(
    context: { restaurantId: string; locationId: string },
    type = 'bill.updated',
  ) {
    await prisma.outboxEvent.create({ data: { ...(await eventData(context)), eventType: type } });
    return (await store.claim(10, 60, 8, context.restaurantId))[0]!;
  }
  function nextHint(client: Socket): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Expected invalidation missing')), 2000);
      client.once('invalidate', (value: unknown) => {
        clearTimeout(timer);
        resolve(value);
      });
    });
  }
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new FoundationExceptionFilter());
    prisma = app.get(PrismaService);
    store = app.get(OutboxStore);
    tickets = app.get(RealtimeTicketService);
    realtime = app.get(RealtimeService);
    server = app.getHttpServer() as Server;
    realtime.attach(server);
    await app.listen(0, '127.0.0.1');
    const identity = await prisma.$queryRaw<
      Array<{ name: string }>
    >`SELECT current_database() AS name`;
    if (identity[0]?.name !== target.pathname.slice(1))
      throw new Error('Database identity mismatch before writes');
    endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    local = await fixture();
    foreign = await fixture();
  });
  afterEach(() => {
    clients.splice(0).forEach((client) => client.disconnect());
  });
  // Retain financial history. Remove only owned RBAC fixtures so global permission-code fixtures remain rerunnable.
  afterAll(async () => {
    try {
      if (prisma && fixtureRoleIds.length) {
        await prisma.membershipRole.deleteMany({ where: { roleId: { in: fixtureRoleIds } } });
        await prisma.rolePermission.deleteMany({ where: { roleId: { in: fixtureRoleIds } } });
        await prisma.role.deleteMany({ where: { id: { in: fixtureRoleIds } } });
        await prisma.permission.deleteMany({
          where: { id: { in: [...createdPermissionIds] }, roles: { none: {} } },
        });
      }
    } finally {
      if (app) await app.close();
    }
  });

  it('keeps uncommitted events invisible and permits claiming only after commit', async () => {
    const context = await scope();
    let ready!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const transaction = prisma.$transaction(
      async (tx) => {
        await tx.outboxEvent.create({ data: await eventData(context) });
        ready();
        await gate;
      },
      { timeout: 10_000 },
    );
    await started;
    try {
      expect(await store.claim(10, 60, 8, context.restaurantId)).toEqual([]);
    } finally {
      release();
    }
    await transaction;
    expect(await store.claim(10, 60, 8, context.restaurantId)).toHaveLength(1);
  });

  it('gives concurrent publishers disjoint claims with bounded batches', async () => {
    const context = await scope();
    await prisma.outboxEvent.createMany({
      data: await Promise.all(Array.from({ length: 4 }, () => eventData(context))),
    });
    const [a, b] = await Promise.all([
      store.claim(2, 60, 8, context.restaurantId),
      store.claim(2, 60, 8, context.restaurantId),
    ]);
    expect(a).toHaveLength(2);
    expect(b).toHaveLength(2);
    expect(new Set([...a, ...b].map((row) => row.id)).size).toBe(4);
  });

  it('recovers expired leases and fences the crashed worker from completion or failure writes', async () => {
    const context = await scope();
    const first = await claimEvent(context);
    await prisma.outboxEvent.update({
      where: { id: first.id },
      data: { leaseUntil: new Date(Date.now() - 1000) },
    });
    const replacement = (await store.claim(1, 60, 8, context.restaurantId))[0]!;
    expect(replacement.claimToken).not.toBe(first.claimToken);
    expect(replacement.attemptCount).toBe(2);
    expect(await store.complete(first)).toBe(false);
    await store.fail(first, 8);
    expect(await store.complete(replacement)).toBe(true);
  });

  it('backs off failed deliveries and quarantines attempts exhausted by repeated crashes', async () => {
    const context = await scope();
    const first = await claimEvent(context);
    await store.fail(first, 8);
    const failed = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: first.id } });
    expect(failed.publishedAt).toBeNull();
    const [schedule] = await prisma.$queryRaw<Array<{ future: boolean }>>`
      SELECT next_attempt_at > clock_timestamp() AS future FROM outbox_event WHERE id = ${first.id}::uuid`;
    expect(schedule!.future).toBe(true);
    expect(failed.attemptCount).toBe(1);
    expect(failed.claimToken).toBeNull();
    expect(failed.leaseUntil).toBeNull();
    expect(await store.claim(1, 60, 8, context.restaurantId)).toEqual([]);
    await prisma.outboxEvent.update({
      where: { id: first.id },
      data: {
        nextAttemptAt: failed.occurredAt,
        attemptCount: 8,
        claimToken: randomUUID(),
        leaseUntil: failed.occurredAt,
      },
    });
    expect(await store.claim(1, 60, 8, context.restaurantId)).toEqual([]);
    const quarantined = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: first.id } });
    expect(quarantined.failedAt).not.toBeNull();
    expect(quarantined).toMatchObject({
      attemptCount: 8,
      claimToken: null,
      leaseUntil: null,
      publishedAt: null,
      lastError: 'OUTBOX_ATTEMPTS_EXHAUSTED',
    });
  });

  it('preserves publication and retry timelines when event time is ahead of the database clock', async () => {
    const context = await scope();
    const data = await eventData(context);
    const occurredAt = new Date(data.occurredAt.getTime() + 30_000);
    const published = await prisma.outboxEvent.create({ data: { ...data, occurredAt } });
    const [claim] = await store.claim(1, 60, 8, context.restaurantId);
    expect(claim!.id).toBe(published.id);
    expect(await store.complete(claim!)).toBe(true);
    expect(
      (
        await prisma.outboxEvent.findUniqueOrThrow({ where: { id: published.id } })
      ).publishedAt!.getTime(),
    ).toBeGreaterThanOrEqual(occurredAt.getTime());

    const retry = await prisma.outboxEvent.create({
      data: { ...(await eventData(context)), occurredAt },
    });
    const [retryClaim] = await store.claim(1, 60, 8, context.restaurantId);
    expect(retryClaim!.id).toBe(retry.id);
    await store.fail(retryClaim!, 8);
    const scheduled = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: retry.id } });
    expect(scheduled.publishedAt).toBeNull();
    expect(scheduled.failedAt).toBeNull();
    expect(scheduled.nextAttemptAt!.getTime()).toBeGreaterThanOrEqual(occurredAt.getTime() + 2000);
  });

  it('enforces Origin, CSRF, current permissions and server-derived ticket resource scope', async () => {
    await request(server)
      .post('/api/v1/staff/realtime/tickets')
      .send({ audience: 'kitchen' })
      .expect(401);
    await request(server)
      .post('/api/v1/staff/realtime/tickets')
      .set('Cookie', `eatease_staff_session=${local.staffToken}`)
      .send({ audience: 'kitchen' })
      .expect(403);
    await request(server)
      .post('/api/v1/staff/realtime/tickets')
      .set('Cookie', `eatease_staff_session=${local.staffToken}`)
      .set('Origin', 'https://attacker.invalid')
      .send({ audience: 'kitchen' })
      .expect(403);
    await request(server)
      .post('/api/v1/staff/realtime/tickets')
      .set('Cookie', `eatease_staff_session=${local.staffToken}`)
      .set('Origin', origin)
      .send({ audience: 'kitchen' })
      .expect(403);
    await issue(local, 'bill', 'staff', foreign.sessionId).expect(403);
    await issue(local, 'kitchen', 'guest').expect(400);
    await issue(local, 'bill', 'guest', foreign.sessionId).expect(400);
    const permission = await prisma.permission.findUniqueOrThrow({
      where: { code: 'fulfillment.read' },
    });
    await prisma.rolePermission.delete({
      where: { roleId_permissionId: { roleId: local.roleId, permissionId: permission.id } },
    });
    try {
      await issue(local).expect(403);
    } finally {
      await prisma.rolePermission.create({
        data: { roleId: local.roleId, permissionId: permission.id },
      });
    }
  });

  it('stores ticket hashes only and atomically consumes once under a concurrent handshake race', async () => {
    const response = await issue(local).expect(201).expect('Cache-Control', 'no-store');
    const token = tokenFrom(response);
    const row = await prisma.realtimeTicket.findUniqueOrThrow({
      where: { tokenHash: hashToken(token) },
    });
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(30_000);
    const consumed = await Promise.all([
      tickets.consume(token, origin),
      tickets.consume(token, origin),
    ]);
    expect(consumed.filter(Boolean)).toHaveLength(1);
    await expect(connect(token)).rejects.toThrow('REALTIME_UNAUTHORIZED');
  });

  it('rejects expired tickets, mismatched issuance Origin and revoked sessions on consumption', async () => {
    const token = tokenFrom(await issue(local).expect(201));
    await prisma.realtimeTicket.update({
      where: { tokenHash: hashToken(token) },
      data: { createdAt: new Date(Date.now() - 60_000), expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(connect(token)).rejects.toThrow('REALTIME_UNAUTHORIZED');
    const fresh = tokenFrom(await issue(local).expect(201));
    expect(await tickets.consume(fresh, 'https://attacker.invalid')).toBeNull();
    await prisma.staffSession.update({
      where: { id: local.staffId },
      data: { revokedAt: new Date() },
    });
    try {
      expect(await tickets.consume(fresh, origin)).toBeNull();
    } finally {
      await prisma.staffSession.update({ where: { id: local.staffId }, data: { revokedAt: null } });
    }
  });

  it('bounds concurrent outstanding ticket issuance per actor session', async () => {
    const isolated = await fixture();
    const responses = await Promise.all(Array.from({ length: 5 }, () => issue(isolated)));
    expect(responses.filter((response) => response.status === 201)).toHaveLength(4);
    expect(responses.filter((response) => response.status === 429)).toHaveLength(1);
  });

  it('rejects expired Staff sessions and closed TableSessions without weakening timeline constraints', async () => {
    const isolated = await fixture();
    const expiredAt = new Date(Date.now() - 1000);
    await prisma.staffSession.update({
      where: { id: isolated.staffId },
      data: { createdAt: new Date(expiredAt.getTime() - 1000), expiresAt: expiredAt },
    });
    await issue(isolated).expect(401);
    const token = tokenFrom(await issue(isolated, 'bill', 'guest').expect(201));
    await prisma.tableSession.update({
      where: { id: isolated.sessionId },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
        closedByMembershipId: isolated.membershipId,
        closeReason: 'M211 isolated test closure',
      },
    });
    expect(await tickets.consume(token, origin)).toBeNull();
    await issue(isolated, 'bill', 'guest').expect(403);
    await issue(isolated, 'activation', 'guest').expect(403);
  });

  it('delivers minimal duplicate-tolerant hints only to matching table/location audiences', async () => {
    const guest = await connect(tokenFrom(await issue(local, 'bill', 'guest').expect(201)));
    const other = await connect(tokenFrom(await issue(foreign, 'bill', 'guest').expect(201)));
    const received: unknown[] = [];
    other.on('invalidate', (value: unknown) => received.push(value));
    const context = { restaurantId: local.restaurantId, locationId: local.locationId };
    const event = await claimEvent(context);
    const before = await prisma.bill.findUnique({ where: { tableSessionId: local.sessionId } });
    const one = nextHint(guest);
    await realtime.emit(event);
    const hint = await one;
    expect(hint).toEqual({
      eventId: event.id,
      type: 'bill.updated',
      resourceId: event.aggregateId,
      version: 1,
    });
    const two = nextHint(guest);
    await realtime.emit(event);
    expect(await two).toEqual(hint);
    expect(received).toEqual([]);
    expect(await prisma.bill.findUnique({ where: { tableSessionId: local.sessionId } })).toEqual(
      before,
    );
    await store.complete(event);
  });

  it('revalidates active membership before fanout and disconnects revoked access', async () => {
    const client = await connect(tokenFrom(await issue(local).expect(201)));
    const disconnected = new Promise<void>((resolve) => client.once('disconnect', () => resolve()));
    await prisma.staffMembership.update({
      where: { id: local.membershipId },
      data: { status: 'REVOKED' },
    });
    try {
      await realtime.revalidate();
      await disconnected;
      expect(client.connected).toBe(false);
    } finally {
      await prisma.staffMembership.update({
        where: { id: local.membershipId },
        data: { status: 'ACTIVE' },
      });
    }
  });

  it('keeps Guest activation notifications generic without leaking the requester-only activation ID', async () => {
    const client = await connect(tokenFrom(await issue(local, 'activation', 'guest').expect(201)));
    const privateRequestId = randomUUID();
    const row = await prisma.outboxEvent.create({
      data: {
        restaurantId: local.restaurantId,
        locationId: local.locationId,
        aggregateType: 'ActivationRequest',
        aggregateId: privateRequestId,
        eventType: 'activation.updated',
        payload: { id: privateRequestId, tableId: local.tableId, version: 1 },
      },
    });
    const event = (await store.claim(10, 60, 8, local.restaurantId)).find(
      (item) => item.id === row.id,
    )!;
    const pending = nextHint(client);
    await realtime.emit(event);
    const hint = await pending;
    expect(hint).toEqual({
      eventId: row.id,
      type: 'activation.updated',
      resourceId: 'current-table',
      version: 1,
    });
    expect(JSON.stringify(hint)).not.toContain(privateRequestId);
    await store.complete(event);
  });

  it('revalidates revoked Guest credentials before emission and sends no hint', async () => {
    const client = await connect(tokenFrom(await issue(local, 'bill', 'guest').expect(201)));
    const received: unknown[] = [];
    client.on('invalidate', (value: unknown) => received.push(value));
    const disconnected = new Promise<void>((resolve) => client.once('disconnect', () => resolve()));
    const event = await claimEvent(local);
    await prisma.guestSession.update({
      where: { id: local.guestId },
      data: { revokedAt: new Date() },
    });
    try {
      await realtime.emit(event);
      await disconnected;
      expect(received).toEqual([]);
    } finally {
      await prisma.guestSession.update({ where: { id: local.guestId }, data: { revokedAt: null } });
      await store.complete(event);
    }
  });

  it('isolates two Guest bill subscriptions on different tables in the same location', async () => {
    const context = { restaurantId: local.restaurantId, locationId: local.locationId };
    const guestToken = randomUUID();
    const table = await prisma.restaurantTable.create({
      data: {
        ...context,
        code: `A-${randomUUID().slice(0, 8)}`,
        capacity: 4,
        physicalStatus: 'OCCUPIED',
      },
    });
    const guest = await prisma.guestSession.create({
      data: {
        ...context,
        tableId: table.id,
        tokenHash: hashToken(guestToken),
        csrfTokenHash: hashToken(local.csrf),
        idleExpiresAt: new Date(Date.now() + 1_800_000),
        absoluteExpiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    const activation = await prisma.activationRequest.create({
      data: {
        ...context,
        tableId: table.id,
        requesterGuestSessionId: guest.id,
        status: 'APPROVED',
        handledByMembershipId: local.membershipId,
        handledAt: new Date(),
        expiresAt: new Date(Date.now() + 300_000),
        version: 1,
      },
    });
    const session = await prisma.tableSession.create({
      data: {
        ...context,
        tableId: table.id,
        activationRequestId: activation.id,
        activatedByMembershipId: local.membershipId,
      },
    });
    await prisma.bill.create({ data: { ...context, tableSessionId: session.id } });
    await prisma.guestSession.update({
      where: { id: guest.id },
      data: { accessLevel: 'ORDER_ENABLED', tableSessionId: session.id },
    });
    const other = await connect(
      tokenFrom(await issue({ ...local, guestToken }, 'bill', 'guest').expect(201)),
    );
    const client = await connect(tokenFrom(await issue(local, 'bill', 'guest').expect(201)));
    const received: unknown[] = [];
    other.on('invalidate', (value: unknown) => received.push(value));
    const event = await claimEvent(local);
    const hint = nextHint(client);
    await realtime.emit(event);
    await hint;
    expect(received).toEqual([]);
    await store.complete(event);
  });

  it('never marks failed transport emission published and never modifies business records', async () => {
    const context = await scope();
    const pending = await prisma.outboxEvent.create({ data: await eventData(context) });
    const snapshot = async () => ({
      orders: await prisma.order.count(),
      items: await prisma.orderItem.count(),
      bill: await prisma.bill.findUnique({ where: { tableSessionId: local.sessionId } }),
    });
    const before = await snapshot();
    const broken = {
      emit: () => Promise.reject(new Error('Simulated transport failure')),
    } as unknown as RealtimeService;
    await new OutboxPublisher(store, broken).runOnce(context.restaurantId);
    const failed = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: pending.id } });
    expect(failed.publishedAt).toBeNull();
    expect(failed.lastError).toBe('OUTBOX_DELIVERY_FAILED');
    expect(failed.nextAttemptAt).not.toBeNull();
    expect(await snapshot()).toEqual(before);
  });

  it('quarantines malformed events without transport or financial side effects', async () => {
    const context = await scope();
    const invalid = await prisma.outboxEvent.create({
      data: { ...(await eventData(context)), payload: {} },
    });
    await app.get(OutboxPublisher).runOnce(context.restaurantId);
    const row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: invalid.id } });
    expect(row.failedAt).not.toBeNull();
    expect(row.publishedAt).toBeNull();
    expect(row.lastError).toBe('OUTBOX_EVENT_INVALID');
  });
});
