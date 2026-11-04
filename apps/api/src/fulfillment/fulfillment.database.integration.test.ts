import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module.js';
import { FoundationExceptionFilter } from '../common/filters/foundation-exception.filter.js';
import { PrismaService } from '../database/prisma.service.js';
import { OrderPersistence } from '../ordering/order-persistence.js';
import { hashToken } from '../staff-auth/auth.crypto.js';
import type { StaffPrincipal } from '../staff-auth/staff-auth.types.js';
import { FulfillmentService } from './fulfillment.service.js';

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
    for (const code of ['fulfillment.read', 'order.create_for_table']) {
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
        csrfTokenHash: hashToken(randomUUID()),
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
        tokenHash: hashToken(randomUUID()),
        csrfTokenHash: hashToken(randomUUID()),
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
      '?status=READY',
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
    }
    await prisma.orderItem.update({
      where: { id: first.id },
      data: { status: 'NEW', version: { increment: 1 } },
    });
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
});
