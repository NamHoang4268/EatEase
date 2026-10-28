import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/prisma/client.js';
import {
  ActivationRequestStatus,
  AuditActorType,
  GuestAccessLevel,
  TableSessionStatus,
} from '../generated/prisma/enums.js';

const databaseUrlValue = process.env.DATABASE_URL;
if (!databaseUrlValue) throw new Error('DATABASE_URL is required for M2.6 integration tests.');

const databaseUrl = new URL(databaseUrlValue);
const databaseName = databaseUrl.pathname.replace(/^\//, '');
const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(databaseUrl.hostname);
if (!isLocalHost || (databaseName !== 'eatease_m2_test' && process.env.CI !== 'true')) {
  throw new Error('M2.6 integration tests require isolated local eatease_m2_test or ephemeral CI.');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrlValue, max: 2 }),
});

const ids = {
  restaurantA: 'a1000000-0000-4000-8000-000000000001',
  restaurantB: 'a1000000-0000-4000-8000-000000000002',
  locationA: 'a2000000-0000-4000-8000-000000000001',
  locationB: 'a2000000-0000-4000-8000-000000000002',
  tableA: 'a3000000-0000-4000-8000-000000000001',
  tableB: 'a3000000-0000-4000-8000-000000000002',
  staffUser: 'a4000000-0000-4000-8000-000000000001',
  membership: 'a5000000-0000-4000-8000-000000000001',
  guestA: 'a6000000-0000-4000-8000-000000000001',
  guestB: 'a6000000-0000-4000-8000-000000000002',
  activationA: 'a7000000-0000-4000-8000-000000000001',
  activationASecond: 'a7000000-0000-4000-8000-000000000002',
  tableSession: 'a8000000-0000-4000-8000-000000000001',
  bill: 'a9000000-0000-4000-8000-000000000001',
} as const;

async function cleanup(): Promise<void> {
  await prisma.auditLog.deleteMany({ where: { restaurantId: ids.restaurantA } });
  await prisma.outboxEvent.deleteMany({ where: { restaurantId: ids.restaurantA } });
  await prisma.bill.deleteMany({ where: { restaurantId: ids.restaurantA } });
  await prisma.guestSession.updateMany({
    where: { id: { in: [ids.guestA, ids.guestB] } },
    data: {
      accessLevel: GuestAccessLevel.BROWSE_ONLY,
      tableSessionId: null,
      previousTokenHash: null,
      previousCsrfTokenHash: null,
      previousTokenValidUntil: null,
    },
  });
  await prisma.tableSession.deleteMany({ where: { restaurantId: ids.restaurantA } });
  await prisma.activationRequest.deleteMany({ where: { restaurantId: ids.restaurantA } });
  await prisma.guestSession.deleteMany({ where: { id: { in: [ids.guestA, ids.guestB] } } });
  await prisma.staffMembership.deleteMany({ where: { id: ids.membership } });
  await prisma.staffUser.deleteMany({ where: { id: ids.staffUser } });
  await prisma.restaurantTable.deleteMany({
    where: { id: { in: [ids.tableA, ids.tableB] } },
  });
  await prisma.location.deleteMany({ where: { id: { in: [ids.locationA, ids.locationB] } } });
  await prisma.restaurant.deleteMany({
    where: { id: { in: [ids.restaurantA, ids.restaurantB] } },
  });
}

describe('M2.6 database foundation constraints', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await cleanup();

    await prisma.restaurant.createMany({
      data: [
        { id: ids.restaurantA, name: 'M2.6 Restaurant A' },
        { id: ids.restaurantB, name: 'M2.6 Restaurant B' },
      ],
    });
    await prisma.location.createMany({
      data: [
        {
          id: ids.locationA,
          restaurantId: ids.restaurantA,
          code: 'M26-A',
          name: 'M2.6 Location A',
          isActive: true,
        },
        {
          id: ids.locationB,
          restaurantId: ids.restaurantB,
          code: 'M26-B',
          name: 'M2.6 Location B',
          isActive: true,
        },
      ],
    });
    await prisma.restaurantTable.createMany({
      data: [
        {
          id: ids.tableA,
          restaurantId: ids.restaurantA,
          locationId: ids.locationA,
          code: 'M26-A1',
          capacity: 4,
        },
        {
          id: ids.tableB,
          restaurantId: ids.restaurantB,
          locationId: ids.locationB,
          code: 'M26-B1',
          capacity: 4,
        },
      ],
    });
    await prisma.staffUser.create({
      data: {
        id: ids.staffUser,
        email: 'm2-6-schema@example.test',
        passwordHash: 'scrypt$fixture',
        name: 'M2.6 Staff',
      },
    });
    await prisma.staffMembership.create({
      data: {
        id: ids.membership,
        staffUserId: ids.staffUser,
        restaurantId: ids.restaurantA,
        locationId: ids.locationA,
      },
    });
    await prisma.guestSession.createMany({
      data: [
        {
          id: ids.guestA,
          restaurantId: ids.restaurantA,
          locationId: ids.locationA,
          tableId: ids.tableA,
          tokenHash: 'a'.repeat(64),
          csrfTokenHash: 'b'.repeat(64),
          idleExpiresAt: new Date(Date.now() + 30 * 60_000),
          absoluteExpiresAt: new Date(Date.now() + 8 * 60 * 60_000),
        },
        {
          id: ids.guestB,
          restaurantId: ids.restaurantB,
          locationId: ids.locationB,
          tableId: ids.tableB,
          tokenHash: 'c'.repeat(64),
          csrfTokenHash: 'd'.repeat(64),
          idleExpiresAt: new Date(Date.now() + 30 * 60_000),
          absoluteExpiresAt: new Date(Date.now() + 8 * 60 * 60_000),
        },
      ],
    });

    const handledAt = new Date();
    await prisma.activationRequest.createMany({
      data: [ids.activationA, ids.activationASecond].map((id) => ({
        id,
        restaurantId: ids.restaurantA,
        locationId: ids.locationA,
        tableId: ids.tableA,
        requesterGuestSessionId: ids.guestA,
        status: ActivationRequestStatus.APPROVED,
        expiresAt: new Date(Date.now() + 5 * 60_000),
        handledByMembershipId: ids.membership,
        handledAt,
        version: 1,
      })),
    });
    await prisma.tableSession.create({
      data: {
        id: ids.tableSession,
        restaurantId: ids.restaurantA,
        locationId: ids.locationA,
        tableId: ids.tableA,
        activationRequestId: ids.activationA,
        activatedByMembershipId: ids.membership,
      },
    });
    await prisma.bill.create({
      data: {
        id: ids.bill,
        restaurantId: ids.restaurantA,
        locationId: ids.locationA,
        tableSessionId: ids.tableSession,
      },
    });
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('creates one active TableSession and one zero-value OPEN Bill', async () => {
    const session = await prisma.tableSession.findUniqueOrThrow({
      where: { id: ids.tableSession },
      include: { bill: true },
    });
    expect(session.status).toBe(TableSessionStatus.ACTIVE);
    expect(session.bill).toMatchObject({
      subtotalAmount: 0n,
      adjustmentAmount: 0n,
      totalAmount: 0n,
      paidAmount: 0n,
      balanceAmount: 0n,
      version: 0,
    });
  });

  it('prevents duplicate active sessions and duplicate Bills', async () => {
    await expect(
      prisma.tableSession.create({
        data: {
          restaurantId: ids.restaurantA,
          locationId: ids.locationA,
          tableId: ids.tableA,
          activationRequestId: ids.activationASecond,
          activatedByMembershipId: ids.membership,
        },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.bill.create({
        data: {
          restaurantId: ids.restaurantA,
          locationId: ids.locationA,
          tableSessionId: ids.tableSession,
        },
      }),
    ).rejects.toThrow();
  });

  it('enforces order access, scoped TableSession binding, and complete hash-only recovery fields', async () => {
    await expect(
      prisma.guestSession.update({
        where: { id: ids.guestB },
        data: { accessLevel: GuestAccessLevel.ORDER_ENABLED },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.guestSession.update({
        where: { id: ids.guestB },
        data: { tableSessionId: ids.tableSession },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.guestSession.update({
        where: { id: ids.guestA },
        data: { previousTokenHash: 'e'.repeat(64) },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.guestSession.update({
        where: { id: ids.guestA },
        data: {
          tableSessionId: ids.tableSession,
          accessLevel: GuestAccessLevel.ORDER_ENABLED,
          previousTokenHash: 'e'.repeat(64),
          previousCsrfTokenHash: 'f'.repeat(64),
          previousTokenValidUntil: new Date(Date.now() + 120_000),
        },
      }),
    ).resolves.toMatchObject({ accessLevel: GuestAccessLevel.ORDER_ENABLED });
  });

  it('enforces Bill arithmetic and scoped reliability records', async () => {
    await expect(
      prisma.bill.update({
        where: { id: ids.bill },
        data: { totalAmount: 1n },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.outboxEvent.create({
        data: {
          restaurantId: ids.restaurantA,
          locationId: ids.locationB,
          aggregateType: 'ActivationRequest',
          aggregateId: ids.activationA,
          eventType: 'activation.updated',
          payload: { status: 'APPROVED' },
        },
      }),
    ).rejects.toThrow();

    await prisma.$transaction([
      prisma.outboxEvent.create({
        data: {
          restaurantId: ids.restaurantA,
          locationId: ids.locationA,
          aggregateType: 'ActivationRequest',
          aggregateId: ids.activationA,
          eventType: 'activation.updated',
          payload: { status: 'APPROVED', version: 1 },
        },
      }),
      prisma.auditLog.create({
        data: {
          restaurantId: ids.restaurantA,
          locationId: ids.locationA,
          actorType: AuditActorType.STAFF_MEMBERSHIP,
          actorId: ids.membership,
          action: 'ACTIVATION_APPROVED',
          resourceType: 'ActivationRequest',
          resourceId: ids.activationA,
          metadata: { physicalPresenceConfirmed: true },
        },
      }),
    ]);

    await expect(
      prisma.auditLog.create({
        data: {
          restaurantId: ids.restaurantA,
          locationId: ids.locationA,
          actorType: AuditActorType.GUEST_SESSION,
          actorId: ids.guestA,
          action: '',
          resourceType: 'ActivationRequest',
          resourceId: ids.activationA,
          metadata: {},
        },
      }),
    ).rejects.toThrow();
  });

  it('allows the approved direct ACTIVE-to-CLOSED force-close shape', async () => {
    await expect(
      prisma.tableSession.update({
        where: { id: ids.tableSession },
        data: {
          status: TableSessionStatus.CLOSED,
          closedByMembershipId: ids.membership,
          closedAt: new Date(),
          closeReason: 'Manager force-close test',
        },
      }),
    ).resolves.toMatchObject({
      status: TableSessionStatus.CLOSED,
      checkoutLockedAt: null,
    });
  });
});
