import { PrismaPg } from '@prisma/adapter-pg';
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient, type Prisma } from '../generated/prisma/client.js';
import { IdempotencyActorType } from '../generated/prisma/enums.js';
import type { PrismaService } from '../database/prisma.service.js';
import { OrderPersistence, type PersistOrderInput } from './order-persistence.js';

const databaseUrlValue = process.env.DATABASE_URL;
if (!databaseUrlValue) throw new Error('DATABASE_URL is required for M2.8 integration tests.');
const target = new URL(databaseUrlValue);
const local = ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname);
if (!local || (target.pathname !== '/eatease_m2_test' && process.env.CI !== 'true')) {
  throw new Error('M2.8 tests require isolated local eatease_m2_test or ephemeral local CI.');
}
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrlValue, max: 5 }),
});
const persistence = new OrderPersistence(prisma as PrismaService);
const ids = {
  restaurant: randomUUID(),
  otherRestaurant: randomUUID(),
  location: randomUUID(),
  otherLocation: randomUUID(),
  foreignLocation: randomUUID(),
  staff: randomUUID(),
  membership: randomUUID(),
  staffSession: randomUUID(),
  role: randomUUID(),
  otherMembership: randomUUID(),
  foreignMembership: randomUUID(),
  table: randomUUID(),
  secondTable: randomUUID(),
  foreignTable: randomUUID(),
  category: randomUUID(),
  foreignCategory: randomUUID(),
  item: randomUUID(),
  bigItem: randomUUID(),
  foreignItem: randomUUID(),
};
type Context = {
  restaurantId: string;
  locationId: string;
  tableSessionId: string;
  billId: string;
  guestId: string;
};
let context: Context;
let second: Context;
let foreign: Context;

async function createContext(
  restaurantId: string,
  locationId: string,
  tableId: string,
  membershipId: string,
): Promise<Context> {
  const guest = await prisma.guestSession.create({
    data: {
      restaurantId,
      locationId,
      tableId,
      tokenHash: createHash('sha256').update(randomUUID()).digest('hex'),
      csrfTokenHash: createHash('sha256').update(randomUUID()).digest('hex'),
      idleExpiresAt: new Date(Date.now() + 30 * 60_000),
      absoluteExpiresAt: new Date(Date.now() + 8 * 60 * 60_000),
    },
  });
  const activation = await prisma.activationRequest.create({
    data: {
      restaurantId,
      locationId,
      tableId,
      requesterGuestSessionId: guest.id,
      status: 'APPROVED',
      handledByMembershipId: membershipId,
      handledAt: new Date(),
      expiresAt: new Date(Date.now() + 300_000),
      version: 1,
    },
  });
  const session = await prisma.tableSession.create({
    data: {
      restaurantId,
      locationId,
      tableId,
      activationRequestId: activation.id,
      activatedByMembershipId: membershipId,
    },
  });
  const bill = await prisma.bill.create({
    data: { restaurantId, locationId, tableSessionId: session.id },
  });
  await prisma.guestSession.update({
    where: { id: guest.id },
    data: { tableSessionId: session.id, accessLevel: 'ORDER_ENABLED' },
  });
  return {
    restaurantId,
    locationId,
    tableSessionId: session.id,
    billId: bill.id,
    guestId: guest.id,
  };
}

function command(overrides: Partial<PersistOrderInput> = {}): PersistOrderInput {
  return {
    restaurantId: context.restaurantId,
    locationId: context.locationId,
    tableSessionId: context.tableSessionId,
    actor: { type: IdempotencyActorType.GUEST_SESSION, id: context.guestId },
    idempotencyKey: randomUUID(),
    idempotencyExpiresAt: new Date(Date.now() + 60 * 60_000),
    items: [{ menuItemId: ids.item, quantity: 2 }],
    ...overrides,
  };
}

async function counts() {
  const where = { restaurantId: ids.restaurant };
  return Promise.all([
    prisma.order.count({ where }),
    prisma.orderItem.count({ where }),
    prisma.billLine.count({ where }),
    prisma.outboxEvent.count({ where }),
    prisma.idempotencyRecord.count({ where }),
    prisma.bill.findUniqueOrThrow({ where: { id: context.billId } }),
  ]);
}

async function rawGraph(
  overrides: {
    order?: Partial<Prisma.OrderUncheckedCreateInput>;
    item?: Partial<Prisma.OrderItemUncheckedCreateInput>;
    line?: Partial<Prisma.BillLineUncheckedCreateInput>;
    omitLine?: boolean;
  } = {},
) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        restaurantId: context.restaurantId,
        locationId: context.locationId,
        tableSessionId: context.tableSessionId,
        billId: context.billId,
        orderNumber: randomUUID(),
        itemCount: 1,
        source: 'STAFF_WAITER',
        createdByMembershipId: ids.membership,
        ...overrides.order,
      },
    });
    const item = await tx.orderItem.create({
      data: {
        restaurantId: context.restaurantId,
        locationId: context.locationId,
        billId: context.billId,
        orderId: order.id,
        menuItemId: ids.item,
        nameSnapshot: 'Synthetic dish',
        unitPriceAmount: 42_000n,
        quantity: 2,
        stationSnapshot: 'KITCHEN',
        ...overrides.item,
      },
    });
    if (!overrides.omitLine) {
      const line = await tx.billLine.create({
        data: {
          restaurantId: context.restaurantId,
          locationId: context.locationId,
          billId: context.billId,
          orderItemId: item.id,
          descriptionSnapshot: item.nameSnapshot,
          quantity: item.quantity,
          unitAmount: item.unitPriceAmount,
          lineAmount: item.unitPriceAmount * BigInt(item.quantity),
          ...overrides.line,
        },
      });
      await tx.bill.update({
        where: { id: context.billId },
        data: {
          subtotalAmount: { increment: line.lineAmount },
          totalAmount: { increment: line.lineAmount },
          balanceAmount: { increment: line.lineAmount },
        },
      });
    }
    return order;
  });
}

describe('M2.8 ordering persistence on PostgreSQL', () => {
  beforeAll(async () => {
    await prisma.$connect();
    const identity = await prisma.$queryRaw<
      Array<{ database: string; serverAddress: string | null }>
    >`
      SELECT current_database() AS "database", inet_server_addr()::text AS "serverAddress"
    `;
    if (identity[0]?.database !== target.pathname.slice(1))
      throw new Error('Database identity mismatch.');
    await prisma.restaurant.createMany({
      data: [
        { id: ids.restaurant, name: 'M2.8 isolated synthetic fixture' },
        { id: ids.otherRestaurant, name: 'M2.8 foreign scope fixture' },
      ],
    });
    await prisma.location.createMany({
      data: [
        {
          id: ids.location,
          restaurantId: ids.restaurant,
          code: 'M28',
          name: 'M28',
          isActive: true,
        },
        {
          id: ids.otherLocation,
          restaurantId: ids.restaurant,
          code: 'M28-INACTIVE',
          name: 'M28 other',
          isActive: false,
        },
        {
          id: ids.foreignLocation,
          restaurantId: ids.otherRestaurant,
          code: 'M28-FOREIGN',
          name: 'M28 foreign',
          isActive: true,
        },
      ],
    });
    await prisma.staffUser.create({
      data: {
        id: ids.staff,
        email: `m28-${ids.staff}@example.test`,
        passwordHash: 'scrypt$fixture',
        name: 'Synthetic persistence actor',
      },
    });
    await prisma.staffMembership.createMany({
      data: [
        {
          id: ids.membership,
          staffUserId: ids.staff,
          restaurantId: ids.restaurant,
          locationId: ids.location,
        },
        {
          id: ids.otherMembership,
          staffUserId: ids.staff,
          restaurantId: ids.restaurant,
          locationId: ids.otherLocation,
        },
        {
          id: ids.foreignMembership,
          staffUserId: ids.staff,
          restaurantId: ids.otherRestaurant,
          locationId: ids.foreignLocation,
        },
      ],
    });
    const orderPermission = await prisma.permission.upsert({
      where: { code: 'order.create_for_table' },
      create: { code: 'order.create_for_table' },
      update: {},
    });
    await prisma.role.create({
      data: {
        id: ids.role,
        restaurantId: ids.restaurant,
        code: `M28-${ids.role}`,
        name: 'M2.8 order writer',
      },
    });
    await prisma.rolePermission.create({
      data: { roleId: ids.role, permissionId: orderPermission.id },
    });
    await prisma.membershipRole.create({
      data: {
        membershipId: ids.membership,
        roleId: ids.role,
        restaurantId: ids.restaurant,
      },
    });
    await prisma.staffSession.create({
      data: {
        id: ids.staffSession,
        staffUserId: ids.staff,
        membershipId: ids.membership,
        tokenHash: createHash('sha256').update(randomUUID()).digest('hex'),
        csrfTokenHash: createHash('sha256').update(randomUUID()).digest('hex'),
        expiresAt: new Date(Date.now() + 8 * 60 * 60_000),
      },
    });
    await prisma.restaurantTable.createMany({
      data: [
        {
          id: ids.table,
          restaurantId: ids.restaurant,
          locationId: ids.location,
          code: 'M28-1',
          capacity: 4,
        },
        {
          id: ids.secondTable,
          restaurantId: ids.restaurant,
          locationId: ids.location,
          code: 'M28-2',
          capacity: 4,
        },
        {
          id: ids.foreignTable,
          restaurantId: ids.otherRestaurant,
          locationId: ids.foreignLocation,
          code: 'M28-F',
          capacity: 4,
        },
      ],
    });
    await prisma.menuCategory.createMany({
      data: [
        {
          id: ids.category,
          restaurantId: ids.restaurant,
          locationId: ids.location,
          name: 'M28',
          displayOrder: 1,
        },
        {
          id: ids.foreignCategory,
          restaurantId: ids.otherRestaurant,
          locationId: ids.foreignLocation,
          name: 'Foreign',
          displayOrder: 1,
        },
      ],
    });
    await prisma.menuItem.createMany({
      data: [
        {
          id: ids.item,
          restaurantId: ids.restaurant,
          locationId: ids.location,
          categoryId: ids.category,
          name: 'Synthetic dish',
          priceAmount: 42_000n,
          fulfillmentStation: 'KITCHEN',
        },
        {
          id: ids.bigItem,
          restaurantId: ids.restaurant,
          locationId: ids.location,
          categoryId: ids.category,
          name: 'Precision fixture',
          priceAmount: 9_007_199_254_740_993n,
          fulfillmentStation: 'BAR',
        },
        {
          id: ids.foreignItem,
          restaurantId: ids.otherRestaurant,
          locationId: ids.foreignLocation,
          categoryId: ids.foreignCategory,
          name: 'Foreign dish',
          priceAmount: 1n,
          fulfillmentStation: 'DIRECT',
        },
      ],
    });
    context = await createContext(ids.restaurant, ids.location, ids.table, ids.membership);
    second = await createContext(ids.restaurant, ids.location, ids.secondTable, ids.membership);
    foreign = await createContext(
      ids.otherRestaurant,
      ids.foreignLocation,
      ids.foreignTable,
      ids.foreignMembership,
    );
  });

  // Financial history is append-only. Keep this run's random synthetic fixture in the isolated
  // test DB rather than disabling immutability triggers or deleting submitted history.
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('atomically persists guest and staff Orders into one consolidated Bill', async () => {
    const before = await prisma.bill.findUniqueOrThrow({ where: { id: context.billId } });
    const guest = await persistence.persist(command());
    const staff = await persistence.persist(
      command({
        actor: {
          type: IdempotencyActorType.STAFF_MEMBERSHIP,
          id: ids.membership,
          staffSessionId: ids.staffSession,
        },
      }),
    );
    expect(guest.order.id).not.toBe(staff.order.id);
    expect(guest.order.billId).toBe(staff.order.billId);
    expect(staff.bill.subtotalAmount).toBe((before.subtotalAmount + 168_000n).toString());
    const stored = await prisma.order.findUniqueOrThrow({
      where: { id: guest.order.id },
      include: { items: { include: { billLine: true } } },
    });
    expect(stored).toMatchObject({ status: 'SUBMITTED', source: 'QR_GUEST', itemCount: 1 });
    expect(stored.items[0]).toMatchObject({
      status: 'NEW',
      unitPriceAmount: 42_000n,
      quantity: 2,
      modifiersSnapshot: [],
      billLine: { lineAmount: 84_000n },
    });
    const events = await prisma.outboxEvent.findMany({
      where: { aggregateId: { in: [guest.order.id, guest.order.items[0]!.id] } },
    });
    expect(events.map((event) => event.eventType).sort()).toEqual([
      'fulfillment.item.created',
      'order.submitted',
    ]);
    expect(events.every((event) => event.publishedAt === null && event.attemptCount === 0)).toBe(
      true,
    );
    expect(JSON.stringify(events)).not.toMatch(/token|csrf|Synthetic dish/);
    expect(
      await prisma.outboxEvent.count({
        where: {
          aggregateId: context.billId,
          eventType: 'bill.updated',
          payload: { path: ['version'], equals: staff.bill.version },
        },
      }),
    ).toBe(1);
  });

  it('stores exact BIGINT snapshots beyond Number.MAX_SAFE_INTEGER', async () => {
    const result = await persistence.persist(
      command({
        items: [
          { menuItemId: ids.bigItem, quantity: 3 },
          { menuItemId: ids.item, quantity: 1 },
        ],
      }),
    );
    expect(result.order.items[0]!.lineAmount).toBe('27021597764222979');
    const line = await prisma.billLine.findUniqueOrThrow({
      where: { orderItemId: result.order.items[0]!.id },
    });
    expect(line.lineAmount).toBe(27_021_597_764_222_979n);
    expect(await prisma.orderItem.count({ where: { orderId: result.order.id } })).toBe(2);
    const sums = await prisma.billLine.aggregate({
      where: { billId: context.billId },
      _sum: { lineAmount: true },
    });
    expect(result.bill.subtotalAmount).toBe(sums._sum.lineAmount!.toString());
  });

  it('preserves historical snapshots when the menu price/name/station changes', async () => {
    const submitted = await persistence.persist(command());
    await prisma.menuItem.update({
      where: { id: ids.item },
      data: {
        name: 'Changed menu',
        priceAmount: 99_999n,
        fulfillmentStation: 'BAR',
        version: { increment: 1 },
      },
    });
    try {
      const item = await prisma.orderItem.findUniqueOrThrow({
        where: { id: submitted.order.items[0]!.id },
        include: { billLine: true },
      });
      expect(item).toMatchObject({
        nameSnapshot: 'Synthetic dish',
        unitPriceAmount: 42_000n,
        stationSnapshot: 'KITCHEN',
        billLine: { unitAmount: 42_000n, lineAmount: 84_000n },
      });
    } finally {
      await prisma.menuItem.update({
        where: { id: ids.item },
        data: { name: 'Synthetic dish', priceAmount: 42_000n, fulfillmentStation: 'KITCHEN' },
      });
    }
  });

  it('replays one immutable result without duplicate financial writes or events', async () => {
    const input = command();
    const first = await persistence.persist(input);
    const after = await counts();
    expect(
      await persistence.persist({ ...input, idempotencyExpiresAt: new Date(Date.now() + 120_000) }),
    ).toEqual(first);
    expect(await counts()).toEqual(after);
    const record = await prisma.idempotencyRecord.findFirstOrThrow({
      where: {
        actorId: context.guestId,
        operation: 'SUBMIT_ORDER',
        idempotencyKey: input.idempotencyKey,
      },
    });
    expect(record.resourceId).toBe(first.order.id);
    expect(record.responseStatus).toBe(201);
    expect(record.expiresAt.getTime()).toBeLessThanOrEqual(input.idempotencyExpiresAt.getTime());
  });

  it('rejects same-key changed payload or target session with no writes', async () => {
    const input = command({
      actor: {
        type: IdempotencyActorType.STAFF_MEMBERSHIP,
        id: ids.membership,
        staffSessionId: ids.staffSession,
      },
    });
    await persistence.persist(input);
    const before = await counts();
    await expect(
      persistence.persist({ ...input, items: [{ menuItemId: ids.item, quantity: 3 }] }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_KEY_REUSED' } });
    await expect(
      persistence.persist({ ...input, tableSessionId: second.tableSessionId }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_KEY_REUSED' } });
    expect(await counts()).toEqual(before);
  });

  it('serializes concurrent retries into one Order and one event set', async () => {
    const input = command();
    const before = await counts();
    const results = await Promise.all(Array.from({ length: 4 }, () => persistence.persist(input)));
    expect(new Set(results.map((result) => result.order.id)).size).toBe(1);
    const after = await counts();
    expect(after.slice(0, 5)).toEqual([
      before[0] + 1,
      before[1] + 1,
      before[2] + 1,
      before[3] + 3,
      before[4] + 1,
    ]);
  });

  it('preserves distinct concurrent intentional submissions and both Bill contributions', async () => {
    const before = await prisma.bill.findUniqueOrThrow({ where: { id: context.billId } });
    const results = await Promise.all([
      persistence.persist(command()),
      persistence.persist(command()),
    ]);
    expect(new Set(results.map((result) => result.order.id)).size).toBe(2);
    const after = await prisma.bill.findUniqueOrThrow({ where: { id: context.billId } });
    expect(after.subtotalAmount).toBe(before.subtotalAmount + 168_000n);
  });

  it('handles a same-key race across two sessions without partial loser writes', async () => {
    const input = command({
      actor: {
        type: IdempotencyActorType.STAFF_MEMBERSHIP,
        id: ids.membership,
        staffSessionId: ids.staffSession,
      },
    });
    const beforeOrders = await prisma.order.count({ where: { restaurantId: ids.restaurant } });
    const results = await Promise.allSettled([
      persistence.persist(input),
      persistence.persist({ ...input, tableSessionId: second.tableSessionId }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { response: { code: 'IDEMPOTENCY_KEY_REUSED' } },
    });
    expect(await prisma.order.count({ where: { restaurantId: ids.restaurant } })).toBe(
      beforeOrders + 1,
    );
  });

  it('rolls back Order, Items, Lines, Bill and outbox if final idempotency persistence fails', async () => {
    const before = await counts();
    const failing = prisma.$extends({
      query: {
        idempotencyRecord: {
          create: () => Promise.reject(new Error('Injected final persistence failure')),
        },
      },
    });
    await expect(
      new OrderPersistence(failing as unknown as PrismaService).persist(command()),
    ).rejects.toThrow('Injected final persistence failure');
    expect(await counts()).toEqual(before);
  });

  it('rejects unavailable/foreign menu items atomically before financial writes', async () => {
    const before = await counts();
    await expect(
      persistence.persist(
        command({
          items: [
            { menuItemId: ids.item, quantity: 1 },
            { menuItemId: ids.foreignItem, quantity: 1 },
          ],
        }),
      ),
    ).rejects.toMatchObject({ response: { code: 'ORDER_MENU_ITEM_UNAVAILABLE' } });
    await prisma.menuItem.update({ where: { id: ids.item }, data: { status: 'INACTIVE' } });
    try {
      await expect(persistence.persist(command())).rejects.toMatchObject({
        response: { code: 'ORDER_MENU_ITEM_UNAVAILABLE' },
      });
    } finally {
      await prisma.menuItem.update({ where: { id: ids.item }, data: { status: 'ACTIVE' } });
    }
    expect(await counts()).toEqual(before);
  });

  it('rejects client prices and unapproved modifiers rather than persisting financial input', async () => {
    const before = await counts();
    for (const selection of [
      { menuItemId: ids.item, quantity: 1, unitPriceAmount: '1' },
      { menuItemId: ids.item, quantity: 1, modifierSelections: [{ id: randomUUID(), price: 1 }] },
    ]) {
      await expect(
        persistence.persist({ ...command(), items: [selection] } as unknown as PersistOrderInput),
      ).rejects.toMatchObject({ response: { code: 'ORDER_PERSISTENCE_INPUT_INVALID' } });
    }
    expect(await counts()).toEqual(before);
  });

  it('rejects non-active sessions, non-open Bills and wrong-scope actors', async () => {
    const before = await counts();
    await prisma.tableSession.update({
      where: { id: context.tableSessionId },
      data: { status: 'CHECKOUT_LOCKED', checkoutLockedAt: new Date() },
    });
    try {
      await expect(persistence.persist(command())).rejects.toMatchObject({
        response: { code: 'TABLE_SESSION_NOT_ORDERABLE' },
      });
    } finally {
      await prisma.tableSession.update({
        where: { id: context.tableSessionId },
        data: { status: 'ACTIVE', checkoutLockedAt: null },
      });
    }
    await prisma.bill.update({
      where: { id: context.billId },
      data: { status: 'PAYMENT_PENDING' },
    });
    try {
      await expect(persistence.persist(command())).rejects.toMatchObject({
        response: { code: 'BILL_NOT_OPEN' },
      });
    } finally {
      await prisma.bill.update({ where: { id: context.billId }, data: { status: 'OPEN' } });
    }
    for (const actor of [
      { type: IdempotencyActorType.GUEST_SESSION, id: second.guestId },
      { type: IdempotencyActorType.GUEST_SESSION, id: foreign.guestId },
      {
        type: IdempotencyActorType.STAFF_MEMBERSHIP,
        id: ids.otherMembership,
        staffSessionId: ids.staffSession,
      },
    ]) {
      await expect(persistence.persist(command({ actor }))).rejects.toMatchObject({
        response: { code: 'ORDER_SCOPE_DENIED' },
      });
    }
    expect(await counts()).toEqual(before);
  });

  it('enforces actor/source, Bill/session and menu/location foreign keys in PostgreSQL', async () => {
    const before = await counts();
    await expect(rawGraph({ order: { billId: second.billId } })).rejects.toThrow();
    await expect(
      rawGraph({ order: { createdByMembershipId: ids.otherMembership } }),
    ).rejects.toThrow();
    await expect(
      rawGraph({ order: { source: 'QR_GUEST', createdByGuestSessionId: context.guestId } }),
    ).rejects.toThrow();
    await expect(
      rawGraph({
        order: {
          createdByMembershipId: null,
          source: 'QR_GUEST',
          createdByGuestSessionId: second.guestId,
        },
      }),
    ).rejects.toThrow();
    await expect(rawGraph({ item: { menuItemId: ids.foreignItem } })).rejects.toThrow();
    await expect(rawGraph({ line: { billId: second.billId } })).rejects.toThrow();
    expect(await counts()).toEqual(before);
  });

  it('rejects invalid quantities, negative prices and inconsistent BillLine arithmetic', async () => {
    const before = await counts();
    await expect(rawGraph({ item: { quantity: 0 } })).rejects.toThrow();
    await expect(rawGraph({ item: { unitPriceAmount: -1n } })).rejects.toThrow();
    await expect(rawGraph({ line: { lineAmount: 1n } })).rejects.toThrow();
    expect(await counts()).toEqual(before);
  });

  it('defers graph completeness and snapshot matching to commit, then rolls back invalid graphs', async () => {
    const before = await counts();
    await expect(
      prisma.order.create({
        data: {
          restaurantId: context.restaurantId,
          locationId: context.locationId,
          tableSessionId: context.tableSessionId,
          billId: context.billId,
          source: 'STAFF_WAITER',
          createdByMembershipId: ids.membership,
          itemCount: 1,
        },
      }),
    ).rejects.toThrow();
    await expect(rawGraph({ omitLine: true })).rejects.toThrow();
    await expect(
      rawGraph({ line: { quantity: 1, unitAmount: 1n, lineAmount: 1n } }),
    ).rejects.toThrow();
    await expect(rawGraph({ order: { itemCount: 2 } })).rejects.toThrow();
    expect(await counts()).toEqual(before);
  });

  it('blocks direct subtotal drift and modifications/deletions of financial history', async () => {
    const result = await persistence.persist(command());
    const id = result.order.items[0]!.id;
    await expect(
      prisma.bill.update({
        where: { id: context.billId },
        data: {
          subtotalAmount: { increment: 1n },
          totalAmount: { increment: 1n },
          balanceAmount: { increment: 1n },
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.order.update({ where: { id: result.order.id }, data: { orderNumber: 'rewritten' } }),
    ).rejects.toThrow();
    await expect(prisma.order.delete({ where: { id: result.order.id } })).rejects.toThrow();
    await expect(
      prisma.orderItem.update({ where: { id }, data: { unitPriceAmount: 0n } }),
    ).rejects.toThrow();
    await expect(prisma.orderItem.delete({ where: { id } })).rejects.toThrow();
    await expect(
      prisma.billLine.update({
        where: { orderItemId: id },
        data: { descriptionSnapshot: 'rewritten' },
      }),
    ).rejects.toThrow();
    await expect(prisma.billLine.delete({ where: { orderItemId: id } })).rejects.toThrow();
    await expect(
      prisma.billLine.create({
        data: {
          restaurantId: context.restaurantId,
          locationId: context.locationId,
          billId: context.billId,
          orderItemId: id,
          descriptionSnapshot: 'Synthetic dish',
          quantity: 2,
          unitAmount: 42_000n,
          lineAmount: 84_000n,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.$transaction(async (tx) => {
        const appended = await tx.orderItem.create({
          data: {
            restaurantId: context.restaurantId,
            locationId: context.locationId,
            billId: context.billId,
            orderId: result.order.id,
            menuItemId: ids.item,
            nameSnapshot: 'Synthetic dish',
            quantity: 1,
            unitPriceAmount: 42_000n,
            stationSnapshot: 'KITCHEN',
          },
        });
        await tx.billLine.create({
          data: {
            restaurantId: context.restaurantId,
            locationId: context.locationId,
            billId: context.billId,
            orderItemId: appended.id,
            descriptionSnapshot: 'Synthetic dish',
            quantity: 1,
            unitAmount: 42_000n,
            lineAmount: 42_000n,
          },
        });
        await tx.bill.update({
          where: { id: context.billId },
          data: {
            subtotalAmount: { increment: 42_000n },
            totalAmount: { increment: 42_000n },
            balanceAmount: { increment: 42_000n },
          },
        });
      }),
    ).rejects.toThrow();
    // Fulfillment remains item-level. This verifies storage shape, not a new transition API.
    await expect(
      prisma.orderItem.update({
        where: { id },
        data: { status: 'PREPARING', version: { increment: 1 } },
      }),
    ).resolves.toMatchObject({ status: 'PREPARING' });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: result.order.id } })).status).toBe(
      'SUBMITTED',
    );
  });
});
