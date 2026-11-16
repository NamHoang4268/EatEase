import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/prisma/client.js';

const databaseUrlValue = process.env.DATABASE_URL;
if (!databaseUrlValue) throw new Error('DATABASE_URL is required for M4.3 integration tests.');

const databaseUrl = new URL(databaseUrlValue);
const databaseName = databaseUrl.pathname.replace(/^\//, '');
const isLocalHost = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(databaseUrl.hostname);
if (!isLocalHost || (databaseName !== 'eatease_m2_test' && process.env.CI !== 'true')) {
  throw new Error('M4.3 integration tests require isolated local eatease_m2_test or ephemeral CI.');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrlValue, max: 2 }),
});

type Fixture = Awaited<ReturnType<typeof createFixture>>;

async function createFixture() {
  const restaurantId = randomUUID();
  const locationId = randomUUID();
  const tableId = randomUUID();
  const staffUserId = randomUUID();
  const membershipId = randomUUID();
  const guestSessionId = randomUUID();
  const activationRequestId = randomUUID();
  const tableSessionId = randomUUID();
  const billId = randomUUID();
  const now = new Date();

  await prisma.restaurant.create({ data: { id: restaurantId, name: 'M4.3 synthetic' } });
  await prisma.location.create({
    data: { id: locationId, restaurantId, code: `M43-${locationId.slice(0, 6)}`, name: 'M4.3' },
  });
  await prisma.restaurantTable.create({
    data: {
      id: tableId,
      restaurantId,
      locationId,
      code: 'M43-A1',
      capacity: 4,
      physicalStatus: 'OCCUPIED',
    },
  });
  await prisma.staffUser.create({
    data: {
      id: staffUserId,
      email: `m43-${staffUserId}@example.test`,
      passwordHash: 'scrypt$fixture',
      name: 'M4.3 Cashier',
    },
  });
  await prisma.staffMembership.create({
    data: { id: membershipId, staffUserId, restaurantId, locationId },
  });
  await prisma.guestSession.create({
    data: {
      id: guestSessionId,
      restaurantId,
      locationId,
      tableId,
      tokenHash: randomUUID().replaceAll('-', '').padEnd(64, '0'),
      csrfTokenHash: randomUUID().replaceAll('-', '').padEnd(64, '1'),
      idleExpiresAt: new Date(now.getTime() + 30 * 60_000),
      absoluteExpiresAt: new Date(now.getTime() + 8 * 60 * 60_000),
    },
  });
  await prisma.activationRequest.create({
    data: {
      id: activationRequestId,
      restaurantId,
      locationId,
      tableId,
      requesterGuestSessionId: guestSessionId,
      status: 'APPROVED',
      expiresAt: new Date(now.getTime() + 5 * 60_000),
      handledByMembershipId: membershipId,
      handledAt: now,
      version: 1,
    },
  });
  await prisma.tableSession.create({
    data: {
      id: tableSessionId,
      restaurantId,
      locationId,
      tableId,
      activationRequestId,
      activatedByMembershipId: membershipId,
      activatedAt: now,
      status: 'CHECKOUT_LOCKED',
      checkoutLockedAt: now,
    },
  });
  await prisma.bill.create({
    data: { id: billId, restaurantId, locationId, tableSessionId, status: 'PAYMENT_PENDING' },
  });

  return { restaurantId, locationId, tableId, membershipId, tableSessionId, billId };
}

describe('M4.3 Payment and Settlement database foundation', () => {
  let fixture: Fixture;

  beforeAll(async () => {
    await prisma.$connect();
    const identity = await prisma.$queryRaw<Array<{ database: string }>>`
      SELECT current_database() AS "database"`;
    if (identity[0]?.database !== databaseName) {
      throw new Error('M4.3 database identity mismatch before writes.');
    }
    fixture = await createFixture();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('accepts only positive CASH/SUCCEEDED payment records with matching scope', async () => {
    const rollback = new Error('ROLLBACK_VALID_PAYMENT_FIXTURE');
    await expect(
      prisma.$transaction(async (tx) => {
        const payment = await tx.payment.create({
          data: {
            restaurantId: fixture.restaurantId,
            locationId: fixture.locationId,
            billId: fixture.billId,
            amount: 48_000n,
            recordedByMembershipId: fixture.membershipId,
          },
        });
        expect(payment).toMatchObject({ method: 'CASH', status: 'SUCCEEDED', amount: 48_000n });
        throw rollback;
      }),
    ).rejects.toBe(rollback);

    await expect(
      prisma.payment.create({
        data: {
          restaurantId: fixture.restaurantId,
          locationId: fixture.locationId,
          billId: fixture.billId,
          amount: 0n,
          recordedByMembershipId: fixture.membershipId,
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects cross-scope payment and settlement actors', async () => {
    const foreign = await createFixture();
    await expect(
      prisma.payment.create({
        data: {
          restaurantId: fixture.restaurantId,
          locationId: fixture.locationId,
          billId: fixture.billId,
          amount: 1n,
          recordedByMembershipId: foreign.membershipId,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.settlement.create({
        data: {
          restaurantId: fixture.restaurantId,
          locationId: fixture.locationId,
          billId: fixture.billId,
          settledAmount: 0n,
          createdByMembershipId: foreign.membershipId,
        },
      }),
    ).rejects.toThrow();
  });

  it('allows zero-balance settlement without a fake payment and enforces one immutable settlement', async () => {
    await expect(
      prisma.settlement.create({
        data: {
          restaurantId: fixture.restaurantId,
          locationId: fixture.locationId,
          billId: fixture.billId,
          settledAmount: -1n,
          createdByMembershipId: fixture.membershipId,
        },
      }),
    ).rejects.toThrow();

    const settlement = await prisma.$transaction(async (tx) => {
      await tx.bill.update({
        where: { id: fixture.billId },
        data: { status: 'SETTLED', version: { increment: 1 } },
      });
      return tx.settlement.create({
        data: {
          restaurantId: fixture.restaurantId,
          locationId: fixture.locationId,
          billId: fixture.billId,
          settledAmount: 0n,
          createdByMembershipId: fixture.membershipId,
        },
      });
    });
    expect(await prisma.payment.count({ where: { billId: fixture.billId } })).toBe(0);
    expect(await prisma.bill.findUniqueOrThrow({ where: { id: fixture.billId } })).toMatchObject({
      status: 'SETTLED',
      paidAmount: 0n,
      balanceAmount: 0n,
    });

    await expect(
      prisma.settlement.create({
        data: {
          restaurantId: fixture.restaurantId,
          locationId: fixture.locationId,
          billId: fixture.billId,
          settledAmount: 0n,
          createdByMembershipId: fixture.membershipId,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.settlement.update({
        where: { id: settlement.id },
        data: { settledAmount: 1n },
      }),
    ).rejects.toThrow();
    await expect(prisma.settlement.delete({ where: { id: settlement.id } })).rejects.toThrow();
  });

  it('does not mutate the locked session or occupied table when persistence records are added', async () => {
    const [session, table] = await Promise.all([
      prisma.tableSession.findUniqueOrThrow({ where: { id: fixture.tableSessionId } }),
      prisma.restaurantTable.findUniqueOrThrow({ where: { id: fixture.tableId } }),
    ]);
    expect(session.status).toBe('CHECKOUT_LOCKED');
    expect(table.physicalStatus).toBe('OCCUPIED');
  });
});
