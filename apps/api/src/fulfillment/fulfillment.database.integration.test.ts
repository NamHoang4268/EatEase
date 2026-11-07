import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../generated/prisma/client.js';
import { AppModule } from '../app.module.js';
import { FoundationExceptionFilter } from '../common/filters/foundation-exception.filter.js';
import { PrismaService } from '../database/prisma.service.js';
import { OrderPersistence } from '../ordering/order-persistence.js';
import { hashToken } from '../staff-auth/auth.crypto.js';
import type { StaffPrincipal } from '../staff-auth/staff-auth.types.js';
import { FulfillmentService } from './fulfillment.service.js';
import { FulfillmentTransitionService } from './fulfillment-transition.service.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required for M2.10 integration tests.');
const target = new URL(url);
if (
  !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
  (target.pathname !== '/eatease_m2_test' && process.env.CI !== 'true')
) {
  throw new Error('M2.10 requires isolated local eatease_m2_test or ephemeral local CI.');
}
process.env.NODE_ENV = 'test';
process.env.TRUSTED_WEB_ORIGINS = 'http://localhost:3000';

type QueueResult = Awaited<ReturnType<FulfillmentService['list']>>;
type Fixture = {
  restaurantId: string;
  locationId: string;
  tableSessionId: string;
  guestId: string;
  membershipId: string;
  userId: string;
  staffSessionId: string;
  roleId: string;
  itemId: string;
  token: string;
  csrf: string;
  guestToken: string;
  guestCsrf: string;
  permissionId: string;
  categoryId: string;
};

describe('M2.10 read-only fulfillment queue on PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Server;
  let local: Fixture;
  let foreign: Fixture;
  let persistence: OrderPersistence;

  async function fixture(): Promise<Fixture> {
    const restaurantId = randomUUID();
    const locationId = randomUUID();
    const userId = randomUUID();
    const membershipId = randomUUID();
    const roleId = randomUUID();
    const token = randomUUID();
    const csrf = randomUUID();
    const guestToken = randomUUID();
    const guestCsrf = randomUUID();
    await prisma.restaurant.create({ data: { id: restaurantId, name: 'M2.10 synthetic' } });
    await prisma.location.create({
      data: { id: locationId, restaurantId, code: 'M210', name: 'M2.10', isActive: true },
    });
    await prisma.staffUser.create({
      data: {
        id: userId,
        email: `m210-${userId}@example.test`,
        name: 'Kitchen fixture',
        passwordHash: 'scrypt$fixture',
      },
    });
    await prisma.staffMembership.create({
      data: { id: membershipId, staffUserId: userId, restaurantId, locationId },
    });
    await prisma.role.create({
      data: { id: roleId, restaurantId, code: 'M210', name: 'M2.10 test permissions' },
    });
    let permissionId = '';
    for (const code of [
      'fulfillment.read',
      'fulfillment.transition',
      'serving.mark_served',
      'order.create_for_table',
      'order.cancel_new',
      'cancellation.forward_to_kitchen',
      'cancellation.decide_operational',
    ]) {
      const permission = await prisma.permission.upsert({
        where: { code },
        create: { code },
        update: {},
      });
      await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } });
      if (code === 'fulfillment.read') permissionId = permission.id;
    }
    await prisma.membershipRole.create({ data: { membershipId, roleId, restaurantId } });
    const session = await prisma.staffSession.create({
      data: {
        staffUserId: userId,
        membershipId,
        tokenHash: hashToken(token),
        csrfTokenHash: hashToken(csrf),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    const table = await prisma.restaurantTable.create({
      data: { restaurantId, locationId, code: 'A01', capacity: 4, physicalStatus: 'OCCUPIED' },
    });
    const guest = await prisma.guestSession.create({
      data: {
        restaurantId,
        locationId,
        tableId: table.id,
        tokenHash: hashToken(guestToken),
        csrfTokenHash: hashToken(guestCsrf),
        idleExpiresAt: new Date(Date.now() + 1_800_000),
        absoluteExpiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    const activation = await prisma.activationRequest.create({
      data: {
        restaurantId,
        locationId,
        tableId: table.id,
        requesterGuestSessionId: guest.id,
        status: 'APPROVED',
        handledByMembershipId: membershipId,
        handledAt: new Date(),
        expiresAt: new Date(Date.now() + 300_000),
        version: 1,
      },
    });
    const dining = await prisma.tableSession.create({
      data: {
        restaurantId,
        locationId,
        tableId: table.id,
        activationRequestId: activation.id,
        activatedByMembershipId: membershipId,
      },
    });
    await prisma.bill.create({ data: { restaurantId, locationId, tableSessionId: dining.id } });
    await prisma.guestSession.update({
      where: { id: guest.id },
      data: { tableSessionId: dining.id, accessLevel: 'ORDER_ENABLED' },
    });
    const category = await prisma.menuCategory.create({
      data: { restaurantId, locationId, name: 'M210', displayOrder: 1 },
    });
    const item = await prisma.menuItem.create({
      data: {
        restaurantId,
        locationId,
        categoryId: category.id,
        name: 'Historical kitchen snapshot',
        priceAmount: 42_000n,
        fulfillmentStation: 'KITCHEN',
      },
    });
    return {
      restaurantId,
      locationId,
      tableSessionId: dining.id,
      guestId: guest.id,
      membershipId,
      userId,
      staffSessionId: session.id,
      roleId,
      itemId: item.id,
      token,
      csrf,
      guestToken,
      guestCsrf,
      permissionId,
      categoryId: category.id,
    };
  }

  function read(context = local, query = '') {
    return request(server)
      .get(`/api/v1/staff/fulfillment/items${query}`)
      .set('Cookie', `eatease_staff_session=${context.token}`);
  }
  const result = (body: unknown) => (body as { data: QueueResult }).data;
  const errorCode = (body: unknown) => (body as { error: { code: string } }).error.code;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new FoundationExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    persistence = app.get(OrderPersistence);
    server = app.getHttpServer() as Server;
    const identity = await prisma.$queryRaw<
      Array<{ database: string }>
    >`SELECT current_database() AS "database"`;
    if (identity[0]?.database !== target.pathname.slice(1))
      throw new Error('M2.10 database identity mismatch before writes.');
    local = await fixture();
    foreign = await fixture();
  });

  // Append-only financial fixtures are retained under random IDs in the isolated test DB.
  afterAll(async () => {
    if (app) await app.close();
  });

  it('returns an empty queue with no-store and no CSRF/Origin requirement for this GET', async () => {
    const response = await read().expect(200).expect('Cache-Control', 'no-store');
    expect(result(response.body)).toEqual({ items: [], page: { limit: 50, nextCursor: null } });
  });

  it('combines Guest and Waiter items with immutable snapshots and excludes foreign scope', async () => {
    for (const context of [local, foreign]) {
      await persistence.persist({
        restaurantId: context.restaurantId,
        locationId: context.locationId,
        tableSessionId: context.tableSessionId,
        actor: { type: 'GUEST_SESSION', id: context.guestId },
        idempotencyKey: randomUUID(),
        idempotencyExpiresAt: new Date(Date.now() + 600_000),
        items: [
          { menuItemId: context.itemId, quantity: 2, note: 'Không hành' },
          { menuItemId: context.itemId, quantity: 1 },
        ],
      });
      await persistence.persist({
        restaurantId: context.restaurantId,
        locationId: context.locationId,
        tableSessionId: context.tableSessionId,
        actor: {
          type: 'STAFF_MEMBERSHIP',
          id: context.membershipId,
          staffSessionId: context.staffSessionId,
        },
        idempotencyKey: randomUUID(),
        idempotencyExpiresAt: new Date(Date.now() + 600_000),
        items: [{ menuItemId: context.itemId, quantity: 3 }],
      });
    }
    await prisma.menuItem.update({
      where: { id: local.itemId },
      data: { name: 'Changed catalog name', priceAmount: 1n, fulfillmentStation: 'BAR' },
    });
    const response = await read().expect(200);
    const data = result(response.body);
    expect(data.items).toHaveLength(3);
    expect(new Set(data.items.map((item) => item.order.source))).toEqual(
      new Set(['QR_GUEST', 'STAFF_WAITER']),
    );
    for (const item of data.items) {
      expect(item).toMatchObject({
        nameSnapshot: 'Historical kitchen snapshot',
        stationSnapshot: 'KITCHEN',
        tableSessionId: local.tableSessionId,
        table: { code: 'A01' },
      });
      expect(item).not.toHaveProperty('unitPriceAmount');
      expect(item).not.toHaveProperty('billLine');
      expect(item.order).not.toHaveProperty('createdByGuestSessionId');
    }
    expect(data.items.some((item) => item.note === 'Không hành')).toBe(true);
    const other = result((await read(foreign).expect(200)).body);
    expect(other.items.every((item) => item.tableSessionId === foreign.tableSessionId)).toBe(true);
  });

  it('pages deterministically without duplicates including equal submission timestamps', async () => {
    const all = result((await read().expect(200)).body);
    let cursor: string | null = null;
    const ids: string[] = [];
    do {
      const data = result(
        (await read(local, `?limit=1${cursor ? `&cursor=${cursor}` : ''}`).expect(200)).body,
      );
      expect(data.items).toHaveLength(1);
      ids.push(data.items[0]!.id);
      cursor = data.page.nextCursor;
    } while (cursor && ids.length < 5);
    expect(ids).toEqual(all.items.map((item) => item.id));
    expect(new Set(ids).size).toBe(3);
    expect(all.items.map((item) => `${item.order.submittedAt}:${item.id}`)).toEqual(
      all.items.map((item) => `${item.order.submittedAt}:${item.id}`).sort(),
    );
    for (const query of [
      '?limit=0',
      '?limit=101',
      '?cursor=bad',
      '?locationId=foreign',
      '?status=NOT_A_STATUS',
    ]) {
      await read(local, query).expect(400);
    }
  });

  it('filters persisted station/status and never derives fulfillment state from the Order', async () => {
    expect(result((await read(local, '?station=BAR').expect(200)).body).items).toEqual([]);
    const first = result((await read().expect(200)).body).items[0]!;
    for (const status of ['PREPARING', 'READY', 'SERVED', 'REJECTED', 'CANCELLED'] as const) {
      await prisma.orderItem.update({
        where: { id: first.id },
        data: { status, version: { increment: 1 } },
      });
      expect(result((await read().expect(200)).body).items.map((item) => item.id)).not.toContain(
        first.id,
      );
      if (status === 'PREPARING' || status === 'READY' || status === 'CANCELLED') {
        const selected = result(
          (await read(local, `?status=${status}&station=KITCHEN`).expect(200)).body,
        );
        const selectedItem = selected.items.find((item) => item.id === first.id);
        expect(selectedItem).toMatchObject({ status, stationSnapshot: 'KITCHEN' });
        expect(selectedItem?.version).toBeTypeOf('number');
        expect(
          result((await read(foreign, `?status=${status}`).expect(200)).body).items.map(
            (item) => item.id,
          ),
        ).not.toContain(first.id);
        expect(
          result((await read(local, `?status=${status}&station=BAR`).expect(200)).body).items,
        ).toEqual([]);
      }
    }
    await prisma.orderItem.update({
      where: { id: first.id },
      data: { status: 'NEW', version: { increment: 1 } },
    });
  });

  it('pages all operational states and station snapshots without crossing location scope', async () => {
    const contexts = [await fixture(), await fixture()];
    for (const context of contexts) {
      for (const station of ['KITCHEN', 'BAR', 'DIRECT'] as const) {
        await prisma.menuItem.update({
          where: { id: context.itemId },
          data: { fulfillmentStation: station },
        });
        await persistence.persist({
          restaurantId: context.restaurantId,
          locationId: context.locationId,
          tableSessionId: context.tableSessionId,
          actor: { type: 'GUEST_SESSION', id: context.guestId },
          idempotencyKey: randomUUID(),
          idempotencyExpiresAt: new Date(Date.now() + 600_000),
          items: [
            { menuItemId: context.itemId, quantity: 1 },
            { menuItemId: context.itemId, quantity: 2 },
          ],
        });
      }
    }
    const context = contexts[0]!;
    for (const status of ['NEW', 'PREPARING', 'READY', 'SERVED'] as const) {
      for (const entry of contexts)
        await prisma.orderItem.updateMany({
          where: { restaurantId: entry.restaurantId },
          data: { status, version: { increment: 1 } },
        });
      const all = result((await read(context, `?status=${status}`).expect(200)).body);
      expect(all.items).toHaveLength(6);
      expect(
        all.items.every(
          (item) => item.tableSessionId === context.tableSessionId && item.status === status,
        ),
      ).toBe(true);
      for (const station of ['KITCHEN', 'BAR', 'DIRECT']) {
        const ids: string[] = [];
        let cursor: string | null = null;
        do {
          const page = result(
            (
              await read(
                context,
                `?status=${status}&station=${station}&limit=1${cursor ? `&cursor=${cursor}` : ''}`,
              ).expect(200)
            ).body,
          );
          expect(page.items).toHaveLength(1);
          expect(page.items[0]!.stationSnapshot).toBe(station);
          ids.push(page.items[0]!.id);
          cursor = page.page.nextCursor;
        } while (cursor && ids.length < 3);
        expect(ids).toEqual(
          all.items.filter((item) => item.stationSnapshot === station).map((item) => item.id),
        );
        expect(new Set(ids).size).toBe(2);
      }
      await request(server).get(`/api/v1/staff/fulfillment/items?status=${status}`).expect(401);
      await prisma.rolePermission.delete({
        where: {
          roleId_permissionId: { roleId: context.roleId, permissionId: context.permissionId },
        },
      });
      await read(context, `?status=${status}`).expect(403);
      await prisma.rolePermission.create({
        data: { roleId: context.roleId, permissionId: context.permissionId },
      });
    }
  });

  it('denies missing, expired and revoked sessions and membership/permission changes on the next request', async () => {
    await request(server).get('/api/v1/staff/fulfillment/items').expect(401);
    await request(server)
      .get('/api/v1/staff/fulfillment/items')
      .set('Cookie', 'eatease_staff_session=invalid')
      .expect(401);
    const expiredAt = new Date(Date.now() - 1_000);
    await prisma.staffSession.update({
      where: { id: local.staffSessionId },
      data: { createdAt: new Date(expiredAt.getTime() - 1_000), expiresAt: expiredAt },
    });
    await read().expect(401);
    await prisma.staffSession.update({
      where: { id: local.staffSessionId },
      data: { expiresAt: new Date(Date.now() + 3_600_000), revokedAt: new Date() },
    });
    await read().expect(401);
    await prisma.staffSession.update({
      where: { id: local.staffSessionId },
      data: { revokedAt: null },
    });
    await prisma.staffMembership.update({
      where: { id: local.membershipId },
      data: { status: 'REVOKED' },
    });
    await read().expect(401);
    await prisma.staffMembership.update({
      where: { id: local.membershipId },
      data: { status: 'ACTIVE' },
    });
    await prisma.rolePermission.delete({
      where: { roleId_permissionId: { roleId: local.roleId, permissionId: local.permissionId } },
    });
    await read().expect(403);
    await prisma.rolePermission.create({
      data: { roleId: local.roleId, permissionId: local.permissionId },
    });
    await read().expect(200);
  });

  it('includes BAR and DIRECT submissions in the unified queue and filters each station', async () => {
    const selections = [];
    for (const station of ['BAR', 'DIRECT'] as const) {
      const item = await prisma.menuItem.create({
        data: {
          restaurantId: local.restaurantId,
          locationId: local.locationId,
          categoryId: local.categoryId,
          name: `M2.10 ${station}`,
          priceAmount: 10_000n,
          fulfillmentStation: station,
        },
      });
      selections.push({ menuItemId: item.id, quantity: 1 });
    }
    await persistence.persist({
      restaurantId: local.restaurantId,
      locationId: local.locationId,
      tableSessionId: local.tableSessionId,
      actor: { type: 'GUEST_SESSION', id: local.guestId },
      idempotencyKey: randomUUID(),
      idempotencyExpiresAt: new Date(Date.now() + 600_000),
      items: selections,
    });
    for (const station of ['BAR', 'DIRECT']) {
      const page = result((await read(local, `?station=${station}`).expect(200)).body);
      expect(page.items).toHaveLength(1);
      expect(page.items[0]?.stationSnapshot).toBe(station);
    }
    expect(result((await read().expect(200)).body).items).toHaveLength(5);
  });

  it('cannot see uncommitted items and creates no queue entry after rollback', async () => {
    const before = result((await read().expect(200)).body).items.map((item) => item.id);
    await expect(
      prisma.$transaction(async (tx) => {
        const bill = await tx.bill.findUniqueOrThrow({
          where: { tableSessionId: local.tableSessionId },
        });
        const order = await tx.order.create({
          data: {
            restaurantId: local.restaurantId,
            locationId: local.locationId,
            tableSessionId: local.tableSessionId,
            billId: bill.id,
            itemCount: 1,
            source: 'STAFF_WAITER',
            createdByMembershipId: local.membershipId,
          },
        });
        const item = await tx.orderItem.create({
          data: {
            restaurantId: local.restaurantId,
            locationId: local.locationId,
            orderId: order.id,
            billId: bill.id,
            menuItemId: local.itemId,
            nameSnapshot: 'Uncommitted item',
            unitPriceAmount: 1n,
            quantity: 1,
            stationSnapshot: 'KITCHEN',
          },
        });
        await tx.billLine.create({
          data: {
            restaurantId: local.restaurantId,
            locationId: local.locationId,
            billId: bill.id,
            orderItemId: item.id,
            descriptionSnapshot: item.nameSnapshot,
            quantity: 1,
            unitAmount: 1n,
            lineAmount: 1n,
          },
        });
        await tx.bill.update({
          where: { id: bill.id },
          data: {
            subtotalAmount: { increment: 1n },
            totalAmount: { increment: 1n },
            balanceAmount: { increment: 1n },
          },
        });
        expect(result((await read().expect(200)).body).items.map((row) => row.id)).toEqual(before);
        throw new Error('M210 deliberate rollback');
      }),
    ).rejects.toThrow('M210 deliberate rollback');
    expect(result((await read().expect(200)).body).items.map((item) => item.id)).toEqual(before);
  });

  it('executes under a PostgreSQL READ ONLY transaction and leaves operational records unchanged', async () => {
    const snapshot = () =>
      Promise.all([
        prisma.order.findMany({ where: { restaurantId: local.restaurantId } }),
        prisma.orderItem.findMany({ where: { restaurantId: local.restaurantId } }),
        prisma.bill.findMany({ where: { restaurantId: local.restaurantId } }),
        prisma.outboxEvent.findMany({ where: { restaurantId: local.restaurantId } }),
        prisma.staffSession.findUnique({ where: { id: local.staffSessionId } }),
      ]);
    const before = await snapshot();
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const service = new FulfillmentService(tx as unknown as PrismaService);
      const page = await service.list(
        { restaurantId: local.restaurantId, locationId: local.locationId } as StaffPrincipal,
        { status: 'NEW', limit: 50 },
      );
      expect(page.items).toHaveLength(5);
    });
    await read().expect(200);
    expect(await snapshot()).toEqual(before);
  });

  async function preparationFixture(station: 'KITCHEN' | 'BAR' | 'DIRECT' = 'KITCHEN') {
    const context = await fixture();
    await prisma.menuItem.update({
      where: { id: context.itemId },
      data: { fulfillmentStation: station },
    });
    const order = await persistence.persist({
      restaurantId: context.restaurantId,
      locationId: context.locationId,
      tableSessionId: context.tableSessionId,
      actor: { type: 'GUEST_SESSION', id: context.guestId },
      idempotencyKey: randomUUID(),
      idempotencyExpiresAt: new Date(Date.now() + 600_000),
      items: [
        { menuItemId: context.itemId, quantity: 2, note: 'Preserve snapshot' },
        { menuItemId: context.itemId, quantity: 1 },
      ],
    });
    return { ...context, order, targetId: order.order.items[0]!.id };
  }

  function start(
    context: Fixture,
    id: string,
    version = 0,
    key: string = randomUUID(),
    action = 'start-preparation',
  ) {
    return request(server)
      .post(`/api/v1/staff/fulfillment/items/${id}/${action}`)
      .set('Cookie', `eatease_staff_session=${context.token}`)
      .set('Origin', 'http://localhost:3000')
      .set('X-CSRF-Token', context.csrf)
      .set('Idempotency-Key', key)
      .send({ expectedVersion: version });
  }

  function ready(context: Fixture, id: string, version = 0, key: string = randomUUID()) {
    return start(context, id, version, key, 'mark-ready');
  }

  function served(context: Fixture, id: string, version = 1, key: string = randomUUID()) {
    return start(context, id, version, key, 'mark-served');
  }

  async function servingFixture(station: 'KITCHEN' | 'BAR' | 'DIRECT' = 'DIRECT') {
    const f = await preparationFixture(station);
    if (station !== 'DIRECT') await start(f, f.targetId).expect(200);
    await ready(f, f.targetId, station === 'DIRECT' ? 0 : 1).expect(200);
    return f;
  }

  const principalFor = (context: Fixture): StaffPrincipal => ({
    sessionId: context.staffSessionId,
    staffUserId: context.userId,
    membershipId: context.membershipId,
    restaurantId: context.restaurantId,
    locationId: context.locationId,
    email: 'fixture@example.test',
    name: 'Fixture',
    permissions: ['fulfillment.transition', 'serving.mark_served'],
    csrfTokenHash: hashToken(context.csrf),
  });

  it.each(['KITCHEN', 'BAR'] as const)(
    'M3.1 atomically starts %s, records actor/time and preserves financial history',
    async (station) => {
      const f = await preparationFixture(station);
      const before = await prisma.orderItem.findUniqueOrThrow({ where: { id: f.targetId } });
      const financial = () =>
        Promise.all([
          prisma.order.findUnique({ where: { id: f.order.order.id } }),
          prisma.bill.findUnique({ where: { tableSessionId: f.tableSessionId } }),
          prisma.billLine.findMany({
            where: { billId: f.order.order.billId },
            orderBy: { id: 'asc' },
          }),
        ]);
      const financialBefore = await financial();
      const response = await start(f, f.targetId).expect(200).expect('Cache-Control', 'no-store');
      const after = await prisma.orderItem.findUniqueOrThrow({ where: { id: f.targetId } });
      expect(after).toEqual({
        ...before,
        status: 'PREPARING',
        version: 1,
        preparingAt: after.preparingAt,
      });
      expect(after.preparingAt).toBeInstanceOf(Date);
      expect(response.body).toEqual({
        data: {
          item: {
            id: f.targetId,
            status: 'PREPARING',
            version: 1,
            preparingAt: after.preparingAt!.toISOString(),
          },
        },
      });
      expect(await financial()).toEqual(financialBefore);
      const audit = await prisma.auditLog.findMany({ where: { resourceId: f.targetId } });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        actorType: 'STAFF_MEMBERSHIP',
        actorId: f.membershipId,
        action: 'FULFILLMENT_PREPARATION_STARTED',
        createdAt: after.preparingAt,
      });
      const events = await prisma.outboxEvent.findMany({
        where: { aggregateId: f.targetId, eventType: 'fulfillment.item.updated' },
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        restaurantId: f.restaurantId,
        locationId: f.locationId,
        payload: {
          id: f.targetId,
          tableSessionId: f.tableSessionId,
          version: 1,
          status: 'PREPARING',
        },
      });
      expect(result((await read(f).expect(200)).body).items.map((i) => i.id)).not.toContain(
        f.targetId,
      );
      await expect(
        prisma.orderItem.update({ where: { id: f.targetId }, data: { preparingAt: null } }),
      ).rejects.toThrow();
      await expect(
        prisma.orderItem.update({ where: { id: f.targetId }, data: { nameSnapshot: 'tampered' } }),
      ).rejects.toThrow();
    },
  );

  it('M3.1 replays concurrent identical keys once and rejects changed payload or target', async () => {
    const f = await preparationFixture();
    const key = randomUUID();
    const responses = await Promise.all([
      start(f, f.targetId, 0, key),
      start(f, f.targetId, 0, key),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect(responses[0].body).toEqual(responses[1].body);
    expect(errorCode((await start(f, f.targetId, 1, key).expect(409)).body)).toBe(
      'IDEMPOTENCY_KEY_REUSED',
    );
    expect(errorCode((await start(f, f.order.order.items[1]!.id, 0, key).expect(409)).body)).toBe(
      'IDEMPOTENCY_KEY_REUSED',
    );
    expect(await prisma.auditLog.count({ where: { resourceId: f.targetId } })).toBe(1);
    expect(
      await prisma.outboxEvent.count({
        where: { aggregateId: f.targetId, eventType: 'fulfillment.item.updated' },
      }),
    ).toBe(1);
    expect(
      await prisma.idempotencyRecord.count({
        where: { actorId: f.membershipId, operation: 'START_PREPARATION' },
      }),
    ).toBe(1);
  });

  it('M3.1 serializes distinct-key contenders and rejects stale versions', async () => {
    const f = await preparationFixture();
    expect(errorCode((await start(f, f.targetId, 1).expect(409)).body)).toBe(
      'FULFILLMENT_VERSION_CONFLICT',
    );
    const responses = await Promise.all([start(f, f.targetId), start(f, f.targetId)]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await prisma.orderItem.findUnique({ where: { id: f.targetId } })).toMatchObject({
      version: 1,
      status: 'PREPARING',
    });
    expect(await prisma.auditLog.count({ where: { resourceId: f.targetId } })).toBe(1);
  });

  it('M3.1 rejects DIRECT and every non-NEW state without reliability writes', async () => {
    const direct = await preparationFixture('DIRECT');
    expect(errorCode((await start(direct, direct.targetId).expect(409)).body)).toBe(
      'FULFILLMENT_STATION_INVALID',
    );
    const f = await preparationFixture();
    for (const status of ['PREPARING', 'READY', 'SERVED', 'REJECTED', 'CANCELLED'] as const) {
      await prisma.orderItem.update({ where: { id: f.targetId }, data: { status } });
      expect(errorCode((await start(f, f.targetId).expect(409)).body)).toBe(
        'FULFILLMENT_STATE_CONFLICT',
      );
    }
    expect(await prisma.auditLog.count({ where: { resourceId: f.targetId } })).toBe(0);
    expect(
      await prisma.idempotencyRecord.count({
        where: { actorId: f.membershipId, operation: 'START_PREPARATION' },
      }),
    ).toBe(0);
  });

  it.each(['start-preparation', 'mark-ready', 'mark-served'])(
    'shared security denies missing/revoked sessions, Origin/CSRF, permission and cross-location access for %s',
    async (action) => {
      const f =
        action === 'mark-served'
          ? await servingFixture()
          : await preparationFixture(action === 'mark-ready' ? 'DIRECT' : 'KITCHEN');
      const auditCount = await prisma.auditLog.count({ where: { resourceId: f.targetId } });
      const send = (context: Fixture, id: string) =>
        start(context, id, action === 'mark-served' ? 1 : 0, randomUUID(), action);
      const path = `/api/v1/staff/fulfillment/items/${f.targetId}/${action}`;
      await request(server).post(path).send({ expectedVersion: 0 }).expect(401);
      await send(f, f.targetId).unset('Origin').expect(403);
      await send(f, f.targetId).set('Origin', 'https://untrusted.example').expect(403);
      await send(f, f.targetId).unset('X-CSRF-Token').expect(403);
      await send(f, f.targetId).set('X-CSRF-Token', 'invalid').expect(403);
      const expiredAt = new Date(Date.now() - 1_000);
      await prisma.staffSession.update({
        where: { id: f.staffSessionId },
        data: { createdAt: new Date(expiredAt.getTime() - 1_000), expiresAt: expiredAt },
      });
      await send(f, f.targetId).expect(401);
      await prisma.staffSession.update({
        where: { id: f.staffSessionId },
        data: { expiresAt: new Date(Date.now() + 3_600_000) },
      });
      const other = await fixture();
      await send(other, f.targetId).expect(403);
      const permission = await prisma.permission.findUniqueOrThrow({
        where: {
          code: action === 'mark-served' ? 'serving.mark_served' : 'fulfillment.transition',
        },
      });
      await prisma.rolePermission.delete({
        where: { roleId_permissionId: { roleId: f.roleId, permissionId: permission.id } },
      });
      await send(f, f.targetId).expect(403);
      await prisma.rolePermission.create({
        data: { roleId: f.roleId, permissionId: permission.id },
      });
      await prisma.staffSession.update({
        where: { id: f.staffSessionId },
        data: { revokedAt: new Date() },
      });
      await send(f, f.targetId).expect(401);
      expect(await prisma.auditLog.count({ where: { resourceId: f.targetId } })).toBe(auditCount);
    },
  );

  it.each(['start', 'ready', 'served'] as const)(
    'shared transaction revalidates stale principals and replay authorization for %s',
    async (method) => {
      const f =
        method === 'served'
          ? await servingFixture()
          : await preparationFixture(method === 'ready' ? 'DIRECT' : 'KITCHEN');
      const principal = principalFor(f);
      const command = {
        itemId: f.targetId,
        expectedVersion: method === 'served' ? 1 : 0,
        idempotencyKey: randomUUID(),
      };
      const service = app.get(FulfillmentTransitionService);
      await service[method](principal, command);
      const permission = await prisma.permission.findUniqueOrThrow({
        where: { code: method === 'served' ? 'serving.mark_served' : 'fulfillment.transition' },
      });
      await prisma.rolePermission.delete({
        where: { roleId_permissionId: { roleId: f.roleId, permissionId: permission.id } },
      });
      await expect(service[method](principal, command)).rejects.toMatchObject({ status: 403 });
      await prisma.rolePermission.create({
        data: { roleId: f.roleId, permissionId: permission.id },
      });
      await prisma.staffSession.update({
        where: { id: f.staffSessionId },
        data: { revokedAt: new Date() },
      });
      await expect(service[method](principal, command)).rejects.toMatchObject({ status: 401 });
    },
  );

  it.each(['start', 'ready', 'served'] as const)(
    'shared transaction rolls back item, audit, outbox and idempotency for %s after a late failure',
    async (method) => {
      const f =
        method === 'served'
          ? await servingFixture()
          : await preparationFixture(method === 'ready' ? 'DIRECT' : 'KITCHEN');
      const before = await prisma.orderItem.findUniqueOrThrow({ where: { id: f.targetId } });
      const auditsBefore = await prisma.auditLog.count({ where: { resourceId: f.targetId } });
      const eventsBefore = await prisma.outboxEvent.count({
        where: { aggregateId: f.targetId, eventType: 'fulfillment.item.updated' },
      });
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
                      create: () => Promise.reject(new Error('M31 injected late failure')),
                    };
                  return Reflect.get(target, property) as unknown;
                },
              }),
            ),
          ),
        );
      try {
        await expect(
          app.get(FulfillmentTransitionService)[method](principalFor(f), {
            itemId: f.targetId,
            expectedVersion: method === 'served' ? 1 : 0,
            idempotencyKey: randomUUID(),
          }),
        ).rejects.toThrow('M31 injected late failure');
      } finally {
        spy.mockRestore();
      }
      expect(await prisma.orderItem.findUnique({ where: { id: f.targetId } })).toEqual(before);
      expect(await prisma.auditLog.count({ where: { resourceId: f.targetId } })).toBe(auditsBefore);
      expect(
        await prisma.outboxEvent.count({
          where: { aggregateId: f.targetId, eventType: 'fulfillment.item.updated' },
        }),
      ).toBe(eventsBefore);
      expect(
        await prisma.idempotencyRecord.count({
          where: {
            actorId: f.membershipId,
            operation:
              method === 'served'
                ? 'MARK_SERVED'
                : method === 'ready'
                  ? 'MARK_READY'
                  : 'START_PREPARATION',
          },
        }),
      ).toBe(0);
      await (
        method === 'served'
          ? served(f, f.targetId)
          : method === 'ready'
            ? ready(f, f.targetId)
            : start(f, f.targetId)
      ).expect(200);
    },
  );

  it.each(['KITCHEN', 'BAR', 'DIRECT'] as const)(
    'M3.2 atomically marks %s READY with audit/time and immutable financial history',
    async (station) => {
      const f = await preparationFixture(station);
      const version = station === 'DIRECT' ? 0 : 1;
      if (station !== 'DIRECT') await start(f, f.targetId).expect(200);
      const before = await prisma.orderItem.findUniqueOrThrow({ where: { id: f.targetId } });
      const financial = () =>
        Promise.all([
          prisma.order.findUnique({ where: { id: f.order.order.id } }),
          prisma.bill.findUnique({ where: { tableSessionId: f.tableSessionId } }),
          prisma.billLine.findMany({
            where: { billId: f.order.order.billId },
            orderBy: { id: 'asc' },
          }),
        ]);
      const financialBefore = await financial();
      const response = await ready(f, f.targetId, version)
        .expect(200)
        .expect('Cache-Control', 'no-store');
      const after = await prisma.orderItem.findUniqueOrThrow({ where: { id: f.targetId } });
      expect(after).toEqual({
        ...before,
        status: 'READY',
        version: version + 1,
        readyAt: after.readyAt,
      });
      expect(after.readyAt).toBeInstanceOf(Date);
      if (before.preparingAt)
        expect(after.readyAt!.getTime()).toBeGreaterThanOrEqual(before.preparingAt.getTime());
      expect(response.body).toEqual({
        data: {
          item: {
            id: f.targetId,
            status: 'READY',
            version: version + 1,
            readyAt: after.readyAt!.toISOString(),
          },
        },
      });
      expect(await financial()).toEqual(financialBefore);
      const audits = await prisma.auditLog.findMany({
        where: { resourceId: f.targetId, action: 'FULFILLMENT_ITEM_READY' },
      });
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        actorId: f.membershipId,
        actorType: 'STAFF_MEMBERSHIP',
        createdAt: after.readyAt,
        metadata: {
          tableSessionId: f.tableSessionId,
          statusBefore: station === 'DIRECT' ? 'NEW' : 'PREPARING',
          statusAfter: 'READY',
          versionBefore: version,
          versionAfter: version + 1,
        },
      });
      const events = await prisma.outboxEvent.findMany({
        where: { aggregateId: f.targetId, eventType: 'fulfillment.item.updated' },
      });
      expect(events).toHaveLength(station === 'DIRECT' ? 1 : 2);
      expect(
        events.filter((e) => (e.payload as { status: string }).status === 'READY'),
      ).toHaveLength(1);
      const event = events.find((e) => (e.payload as { status: string }).status === 'READY');
      expect(event).toMatchObject({
        restaurantId: f.restaurantId,
        locationId: f.locationId,
        occurredAt: after.readyAt,
        payload: {
          id: f.targetId,
          tableSessionId: f.tableSessionId,
          status: 'READY',
          version: version + 1,
        },
      });
      const idem = await prisma.idempotencyRecord.findFirstOrThrow({
        where: { actorId: f.membershipId, operation: 'MARK_READY' },
      });
      expect(idem).toMatchObject({
        resourceId: f.targetId,
        status: 'COMPLETED',
        responseStatus: 200,
        responseBody: (response.body as { data: unknown }).data,
      });
      await expect(
        prisma.orderItem.update({ where: { id: f.targetId }, data: { readyAt: null } }),
      ).rejects.toThrow();
      await expect(
        prisma.orderItem.update({ where: { id: f.targetId }, data: { status: 'PREPARING' } }),
      ).rejects.toThrow();
      await expect(
        prisma.orderItem.update({ where: { id: f.targetId }, data: { quantity: 99 } }),
      ).rejects.toThrow();
    },
  );

  it.each(['KITCHEN', 'BAR', 'DIRECT'] as const)(
    'M3.2 rejects invalid %s state combinations without side effects',
    async (station) => {
      const f = await preparationFixture(station);
      const invalidStates =
        station === 'DIRECT'
          ? (['PREPARING', 'READY', 'SERVED', 'REJECTED', 'CANCELLED'] as const)
          : (['NEW', 'READY', 'SERVED', 'REJECTED', 'CANCELLED'] as const);
      for (const status of invalidStates) {
        await prisma.orderItem.update({ where: { id: f.targetId }, data: { status } });
        expect(errorCode((await ready(f, f.targetId).expect(409)).body)).toBe(
          'FULFILLMENT_STATE_CONFLICT',
        );
      }
      expect(await prisma.auditLog.count({ where: { resourceId: f.targetId } })).toBe(0);
      expect(
        await prisma.outboxEvent.count({
          where: { aggregateId: f.targetId, eventType: 'fulfillment.item.updated' },
        }),
      ).toBe(0);
      expect(
        await prisma.idempotencyRecord.count({
          where: { actorId: f.membershipId, operation: 'MARK_READY' },
        }),
      ).toBe(0);
    },
  );

  it('M3.2 replays parallel identical requests and rejects reused payload/target', async () => {
    const f = await preparationFixture('DIRECT');
    const key = randomUUID();
    const responses = await Promise.all([
      ready(f, f.targetId, 0, key),
      ready(f, f.targetId, 0, key),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect(responses[0].body).toEqual(responses[1].body);
    expect(errorCode((await ready(f, f.targetId, 1, key).expect(409)).body)).toBe(
      'IDEMPOTENCY_KEY_REUSED',
    );
    expect(errorCode((await ready(f, f.order.order.items[1]!.id, 0, key).expect(409)).body)).toBe(
      'IDEMPOTENCY_KEY_REUSED',
    );
    expect(await prisma.auditLog.count({ where: { resourceId: f.targetId } })).toBe(1);
    expect(
      await prisma.outboxEvent.count({
        where: { aggregateId: f.targetId, eventType: 'fulfillment.item.updated' },
      }),
    ).toBe(1);
    expect(
      await prisma.idempotencyRecord.count({
        where: { actorId: f.membershipId, operation: 'MARK_READY' },
      }),
    ).toBe(1);
  });

  it('M3.2 serializes competing READY commands and rejects stale versions', async () => {
    const f = await preparationFixture('DIRECT');
    expect(errorCode((await ready(f, f.targetId, 1).expect(409)).body)).toBe(
      'FULFILLMENT_VERSION_CONFLICT',
    );
    const responses = await Promise.all([ready(f, f.targetId), ready(f, f.targetId)]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await prisma.orderItem.findUnique({ where: { id: f.targetId } })).toMatchObject({
      status: 'READY',
      version: 1,
    });
    expect(await prisma.auditLog.count({ where: { resourceId: f.targetId } })).toBe(1);
  });

  it('M3.2 cannot skip preparation in a race and keeps operation-scoped replay after READY', async () => {
    const f = await preparationFixture();
    const key = randomUUID();
    const [preparing, prematureReady] = await Promise.all([
      start(f, f.targetId, 0, key),
      ready(f, f.targetId, 0, key),
    ]);
    expect(preparing.status).toBe(200);
    expect(prematureReady.status).toBe(409);
    const response = await ready(f, f.targetId, 1, key).expect(200);
    expect(response.body).not.toEqual(preparing.body);
    expect((await start(f, f.targetId, 0, key).expect(200)).body).toEqual(preparing.body);
    expect((await ready(f, f.targetId, 1, key).expect(200)).body).toEqual(response.body);
    expect(
      await prisma.idempotencyRecord.count({
        where: { actorId: f.membershipId, idempotencyKey: key },
      }),
    ).toBe(2);
    expect(await prisma.auditLog.count({ where: { resourceId: f.targetId } })).toBe(2);
  });

  it.each(['KITCHEN', 'BAR', 'DIRECT'] as const)(
    'M3.4 atomically serves %s with actor/time, scoped outbox and immutable history',
    async (station) => {
      const f = await servingFixture(station);
      const before = await prisma.orderItem.findUniqueOrThrow({ where: { id: f.targetId } });
      const financial = () =>
        Promise.all([
          prisma.order.findUnique({ where: { id: f.order.order.id } }),
          prisma.bill.findUnique({ where: { tableSessionId: f.tableSessionId } }),
          prisma.billLine.findMany({
            where: { billId: f.order.order.billId },
            orderBy: { id: 'asc' },
          }),
        ]);
      const financialBefore = await financial();
      await expect(
        prisma.orderItem.update({ where: { id: f.targetId }, data: { servedAt: new Date() } }),
      ).rejects.toThrow();
      await expect(
        prisma.orderItem.update({
          where: { id: f.targetId },
          data: {
            status: 'SERVED',
            version: { increment: 1 },
            servedAt: new Date(before.readyAt!.getTime() - 1),
          },
        }),
      ).rejects.toThrow();
      const response = await served(f, f.targetId, before.version)
        .expect(200)
        .expect('Cache-Control', 'no-store');
      const after = await prisma.orderItem.findUniqueOrThrow({ where: { id: f.targetId } });
      expect(after).toEqual({
        ...before,
        status: 'SERVED',
        version: before.version + 1,
        servedAt: after.servedAt,
      });
      expect(after.servedAt).toBeInstanceOf(Date);
      expect(after.servedAt!.getTime()).toBeGreaterThanOrEqual(before.readyAt!.getTime());
      expect(response.body).toEqual({
        data: {
          item: {
            id: f.targetId,
            status: 'SERVED',
            version: before.version + 1,
            servedAt: after.servedAt!.toISOString(),
          },
        },
      });
      expect(await financial()).toEqual(financialBefore);
      const audits = await prisma.auditLog.findMany({
        where: { resourceId: f.targetId, action: 'FULFILLMENT_ITEM_SERVED' },
      });
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        actorType: 'STAFF_MEMBERSHIP',
        actorId: f.membershipId,
        createdAt: after.servedAt,
        metadata: {
          tableSessionId: f.tableSessionId,
          statusBefore: 'READY',
          statusAfter: 'SERVED',
          versionBefore: before.version,
          versionAfter: after.version,
        },
      });
      const events = await prisma.outboxEvent.findMany({
        where: { aggregateId: f.targetId, eventType: 'fulfillment.item.updated' },
      });
      const servedEvents = events.filter(
        (e) => (e.payload as { status: string }).status === 'SERVED',
      );
      expect(servedEvents).toHaveLength(1);
      expect(servedEvents[0]).toMatchObject({
        restaurantId: f.restaurantId,
        locationId: f.locationId,
        occurredAt: after.servedAt,
        payload: {
          id: f.targetId,
          tableSessionId: f.tableSessionId,
          status: 'SERVED',
          version: after.version,
        },
      });
      expect(Object.keys(servedEvents[0]!.payload as object).sort()).toEqual([
        'id',
        'occurredAt',
        'status',
        'tableSessionId',
        'version',
      ]);
      const idem = await prisma.idempotencyRecord.findFirstOrThrow({
        where: { actorId: f.membershipId, operation: 'MARK_SERVED' },
      });
      expect(idem).toMatchObject({
        status: 'COMPLETED',
        responseStatus: 200,
        responseBody: (response.body as { data: unknown }).data,
      });
      const readyAttempt = await prisma.idempotencyRecord.findFirstOrThrow({
        where: { actorId: f.membershipId, operation: 'MARK_READY' },
      });
      expect(
        (await ready(f, f.targetId, before.version - 1, readyAttempt.idempotencyKey).expect(200))
          .body,
      ).toEqual({ data: readyAttempt.responseBody });
      await expect(
        prisma.orderItem.update({ where: { id: f.targetId }, data: { servedAt: null } }),
      ).rejects.toThrow();
      await expect(
        prisma.orderItem.update({
          where: { id: f.targetId },
          data: { servedAt: new Date(before.readyAt!.getTime() - 1) },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.orderItem.update({ where: { id: f.targetId }, data: { status: 'READY' } }),
      ).rejects.toThrow();
      expect(
        result((await read(f, '?status=SERVED').expect(200)).body).items.map((item) => item.id),
      ).toContain(f.targetId);
      expect(
        result((await read(f, '?status=READY').expect(200)).body).items.map((item) => item.id),
      ).not.toContain(f.targetId);
    },
  );

  it.each(['NEW', 'PREPARING', 'SERVED', 'REJECTED', 'CANCELLED'] as const)(
    'M3.4 rejects %s without reliability writes',
    async (status) => {
      const f = await preparationFixture();
      await prisma.orderItem.update({ where: { id: f.targetId }, data: { status } });
      expect(errorCode((await served(f, f.targetId, 0).expect(409)).body)).toBe(
        'FULFILLMENT_STATE_CONFLICT',
      );
      expect(await prisma.auditLog.count({ where: { resourceId: f.targetId } })).toBe(0);
      expect(
        await prisma.outboxEvent.count({
          where: { aggregateId: f.targetId, eventType: 'fulfillment.item.updated' },
        }),
      ).toBe(0);
      expect(
        await prisma.idempotencyRecord.count({
          where: { actorId: f.membershipId, operation: 'MARK_SERVED' },
        }),
      ).toBe(0);
    },
  );

  it('M3.4 replays concurrent same-key serving once and rejects changed payload/target', async () => {
    const f = await servingFixture();
    const key = randomUUID();
    const replies = await Promise.all([
      served(f, f.targetId, 1, key),
      served(f, f.targetId, 1, key),
    ]);
    expect(replies.map((reply) => reply.status)).toEqual([200, 200]);
    expect(replies[0].body).toEqual(replies[1].body);
    expect(errorCode((await served(f, f.targetId, 2, key).expect(409)).body)).toBe(
      'IDEMPOTENCY_KEY_REUSED',
    );
    expect(errorCode((await served(f, f.order.order.items[1]!.id, 1, key).expect(409)).body)).toBe(
      'IDEMPOTENCY_KEY_REUSED',
    );
    expect((await served(f, f.targetId, 1, key).expect(200)).body).toEqual(replies[0].body);
    expect(
      await prisma.auditLog.count({
        where: { resourceId: f.targetId, action: 'FULFILLMENT_ITEM_SERVED' },
      }),
    ).toBe(1);
    expect(
      await prisma.idempotencyRecord.count({
        where: { actorId: f.membershipId, operation: 'MARK_SERVED' },
      }),
    ).toBe(1);
    const events = await prisma.outboxEvent.findMany({
      where: { aggregateId: f.targetId, eventType: 'fulfillment.item.updated' },
    });
    expect(
      events.filter((e) => (e.payload as { status: string }).status === 'SERVED'),
    ).toHaveLength(1);
  });

  it('M3.4 serializes distinct-key serving and rejects stale versions', async () => {
    const f = await servingFixture();
    expect(errorCode((await served(f, f.targetId, 0).expect(409)).body)).toBe(
      'FULFILLMENT_VERSION_CONFLICT',
    );
    const replies = await Promise.all([served(f, f.targetId), served(f, f.targetId)]);
    expect(replies.map((reply) => reply.status).sort()).toEqual([200, 409]);
    expect(await prisma.orderItem.findUnique({ where: { id: f.targetId } })).toMatchObject({
      status: 'SERVED',
      version: 2,
    });
    expect(
      await prisma.auditLog.count({
        where: { resourceId: f.targetId, action: 'FULFILLMENT_ITEM_SERVED' },
      }),
    ).toBe(1);
  });

  it('M3.4 serving permission does not require or grant preparation permission', async () => {
    const f = await servingFixture();
    const permission = await prisma.permission.findUniqueOrThrow({
      where: { code: 'fulfillment.transition' },
    });
    await prisma.rolePermission.delete({
      where: { roleId_permissionId: { roleId: f.roleId, permissionId: permission.id } },
    });
    await served(f, f.targetId).expect(200);
    await start(f, f.order.order.items[1]!.id).expect(403);
  });

  it('M3.4 respects legacy NULL timestamps and a recorded readiness ahead of the clock', async () => {
    for (const readyAt of [null, new Date(Date.now() + 60_000)]) {
      const f = await preparationFixture('DIRECT');
      await prisma.orderItem.update({
        where: { id: f.targetId },
        data: { status: 'READY', version: 1, readyAt },
      });
      await served(f, f.targetId).expect(200);
      const after = await prisma.orderItem.findUniqueOrThrow({ where: { id: f.targetId } });
      expect(after.preparingAt).toBeNull();
      expect(after.readyAt).toEqual(readyAt);
      expect(after.servedAt).toBeInstanceOf(Date);
      if (readyAt) expect(after.servedAt!.getTime()).toBeGreaterThanOrEqual(readyAt.getTime());
    }
  });

  it('M3.2 preserves timestamp ordering for a legacy PREPARING row with a clock ahead of the process', async () => {
    const f = await preparationFixture();
    const futurePreparation = new Date(Date.now() + 60_000);
    await prisma.orderItem.update({
      where: { id: f.targetId },
      data: { status: 'PREPARING', version: 1, preparingAt: futurePreparation },
    });
    await ready(f, f.targetId, 1).expect(200);
    expect(await prisma.orderItem.findUnique({ where: { id: f.targetId } })).toMatchObject({
      preparingAt: futurePreparation,
      readyAt: futurePreparation,
      version: 2,
    });
  });

  function guestCancellation(
    context: Fixture,
    itemId: string,
    version: number,
    key: string = randomUUID(),
    reason = 'Khách đổi món',
  ) {
    return request(server)
      .post(`/api/v1/orders/items/${itemId}/cancellation-requests`)
      .set('Cookie', `eatease_guest_session=${context.guestToken}`)
      .set('Origin', 'http://localhost:3000')
      .set('X-CSRF-Token', context.guestCsrf)
      .set('Idempotency-Key', key)
      .send({ expectedVersion: version, reason });
  }

  function cancellationCommand(
    context: Fixture,
    requestId: string,
    endpoint: 'waiter-decision' | 'forward-to-kitchen' | 'operational-decision',
    expectedVersion: number,
    body: { decision?: 'ACCEPT' | 'REJECT'; reason: string },
    key: string = randomUUID(),
  ) {
    return request(server)
      .post(`/api/v1/staff/cancellation-requests/${requestId}/${endpoint}`)
      .set('Cookie', `eatease_staff_session=${context.token}`)
      .set('Origin', 'http://localhost:3000')
      .set('X-CSRF-Token', context.csrf)
      .set('Idempotency-Key', key)
      .send({ expectedVersion, ...body });
  }

  it('M3.5 accepts a NEW Guest request exactly once and records an immutable full waiver', async () => {
    const f = await preparationFixture('KITCHEN');
    const billBefore = await prisma.bill.findUniqueOrThrow({
      where: { tableSessionId: f.tableSessionId },
    });
    const line = await prisma.billLine.findUniqueOrThrow({ where: { orderItemId: f.targetId } });
    const guestKey = randomUUID();
    const requested = await guestCancellation(f, f.targetId, 0, guestKey).expect(201);
    expect((await guestCancellation(f, f.targetId, 0, guestKey).expect(201)).body).toEqual(
      requested.body,
    );
    const cancellation = (requested.body as { data: { cancellationRequest: { id: string } } }).data
      .cancellationRequest;
    const decisionKey = randomUUID();
    const accepted = await cancellationCommand(
      f,
      cancellation.id,
      'waiter-decision',
      0,
      { decision: 'ACCEPT', reason: 'Xác nhận hủy món chưa bắt đầu' },
      decisionKey,
    ).expect(200);
    expect(
      (
        await cancellationCommand(
          f,
          cancellation.id,
          'waiter-decision',
          0,
          { decision: 'ACCEPT', reason: 'Xác nhận hủy món chưa bắt đầu' },
          decisionKey,
        ).expect(200)
      ).body,
    ).toEqual(accepted.body);
    expect(await prisma.orderItem.findUniqueOrThrow({ where: { id: f.targetId } })).toMatchObject({
      status: 'CANCELLED',
      version: 1,
      nameSnapshot: 'Historical kitchen snapshot',
      unitPriceAmount: 42_000n,
    });
    expect(await prisma.billAdjustment.findMany({ where: { orderItemId: f.targetId } })).toEqual([
      expect.objectContaining({
        kind: 'FULL_CANCELLATION_WAIVER',
        amount: -line.lineAmount,
        cancellationRequestId: cancellation.id,
      }),
    ]);
    expect(await prisma.billLine.findUniqueOrThrow({ where: { orderItemId: f.targetId } })).toEqual(
      line,
    );
    expect(await prisma.bill.findUniqueOrThrow({ where: { id: billBefore.id } })).toMatchObject({
      subtotalAmount: billBefore.subtotalAmount,
      adjustmentAmount: -line.lineAmount,
      totalAmount: billBefore.totalAmount - line.lineAmount,
      balanceAmount: billBefore.balanceAmount - line.lineAmount,
      version: billBefore.version + 1,
    });
    expect(
      await prisma.idempotencyRecord.count({
        where: { actorId: f.membershipId, operation: 'DECIDE_WAITER_CANCELLATION' },
      }),
    ).toBe(1);
    expect(
      await prisma.outboxEvent.count({
        where: { aggregateId: f.targetId, eventType: 'fulfillment.item.updated' },
      }),
    ).toBe(1);
  });

  it('M3.5 forwards PREPARING to Kitchen and rejection preserves item and financial obligation', async () => {
    const f = await preparationFixture('BAR');
    await start(f, f.targetId).expect(200);
    const billBefore = await prisma.bill.findUniqueOrThrow({
      where: { tableSessionId: f.tableSessionId },
    });
    const requested = await guestCancellation(f, f.targetId, 1).expect(201);
    const requestId = (requested.body as { data: { cancellationRequest: { id: string } } }).data
      .cancellationRequest.id;
    await cancellationCommand(f, requestId, 'forward-to-kitchen', 0, {
      reason: 'Chuyển đúng trạm Bar',
    }).expect(200);
    await cancellationCommand(f, requestId, 'operational-decision', 1, {
      decision: 'REJECT',
      reason: 'Không thể dừng sau khi pha chế',
    }).expect(200);
    expect(
      await prisma.cancellationRequest.findUniqueOrThrow({ where: { id: requestId } }),
    ).toMatchObject({
      status: 'REJECTED',
      version: 2,
      decidedByMembershipId: f.membershipId,
    });
    expect(await prisma.orderItem.findUniqueOrThrow({ where: { id: f.targetId } })).toMatchObject({
      status: 'PREPARING',
      version: 1,
    });
    expect(await prisma.billAdjustment.count({ where: { orderItemId: f.targetId } })).toBe(0);
    expect(await prisma.bill.findUniqueOrThrow({ where: { id: billBefore.id } })).toEqual(
      billBefore,
    );
  });

  it('M3.5 serializes direct Kitchen rejection and prevents duplicate waivers', async () => {
    const f = await preparationFixture('KITCHEN');
    const key = randomUUID();
    const send = () =>
      request(server)
        .post(`/api/v1/staff/fulfillment/items/${f.targetId}/reject`)
        .set('Cookie', `eatease_staff_session=${f.token}`)
        .set('Origin', 'http://localhost:3000')
        .set('X-CSRF-Token', f.csrf)
        .set('Idempotency-Key', key)
        .send({ expectedVersion: 0, reason: 'Hết nguyên liệu' });
    const replies = await Promise.all([send(), send()]);
    expect(replies.map((reply) => reply.status)).toEqual([200, 200]);
    expect(replies[0].body).toEqual(replies[1].body);
    expect(await prisma.billAdjustment.count({ where: { orderItemId: f.targetId } })).toBe(1);
    expect(await prisma.cancellationRequest.count({ where: { orderItemId: f.targetId } })).toBe(1);
  });
});
