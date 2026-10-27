import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FulfillmentStation,
  MenuCategoryStatus,
  MenuItemStatus,
  RestaurantStatus,
  TablePhysicalStatus,
} from '../generated/prisma/enums.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { catalogFixtureIds, seedCatalogFixtures } from './catalog.fixtures.js';

const databaseUrlValue = process.env.DATABASE_URL;

if (!databaseUrlValue) {
  throw new Error('DATABASE_URL is required for catalog integration tests.');
}

const databaseUrl = new URL(databaseUrlValue);
const databaseName = databaseUrl.pathname.replace(/^\//, '');
const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(databaseUrl.hostname);
const isIsolatedCiDatabase = process.env.CI === 'true';

if (!isLocalHost || (databaseName !== 'eatease_m2_test' && !isIsolatedCiDatabase)) {
  throw new Error(
    'Catalog integration tests require the isolated local eatease_m2_test database or an ephemeral CI database.',
  );
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrlValue, max: 2 }),
});

const ids = {
  restaurantA: '61000000-0000-4000-8000-000000000001',
  restaurantB: '61000000-0000-4000-8000-000000000002',
  locationA: '62000000-0000-4000-8000-000000000001',
  locationAInactive: '62000000-0000-4000-8000-000000000002',
  locationB: '62000000-0000-4000-8000-000000000003',
  categoryA: '63000000-0000-4000-8000-000000000001',
} as const;

const testRestaurantIds = [ids.restaurantA, ids.restaurantB, catalogFixtureIds.restaurant];

async function cleanTestRecords(): Promise<void> {
  await prisma.menuItem.deleteMany({ where: { restaurantId: { in: testRestaurantIds } } });
  await prisma.menuCategory.deleteMany({ where: { restaurantId: { in: testRestaurantIds } } });
  await prisma.restaurantTable.deleteMany({ where: { restaurantId: { in: testRestaurantIds } } });
  await prisma.location.deleteMany({ where: { restaurantId: { in: testRestaurantIds } } });
  await prisma.restaurant.deleteMany({ where: { id: { in: testRestaurantIds } } });
}

describe('catalog database constraints', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await cleanTestRecords();

    await prisma.restaurant.createMany({
      data: [
        { id: ids.restaurantA, name: 'Test Restaurant A', status: RestaurantStatus.ACTIVE },
        { id: ids.restaurantB, name: 'Test Restaurant B', status: RestaurantStatus.ACTIVE },
      ],
    });

    await prisma.location.createMany({
      data: [
        {
          id: ids.locationA,
          restaurantId: ids.restaurantA,
          code: 'A-ACTIVE',
          name: 'Location A',
          isActive: true,
        },
        {
          id: ids.locationAInactive,
          restaurantId: ids.restaurantA,
          code: 'A-INACTIVE',
          name: 'Location A Inactive',
          isActive: false,
        },
        {
          id: ids.locationB,
          restaurantId: ids.restaurantB,
          code: 'B-ACTIVE',
          name: 'Location B',
          isActive: true,
        },
      ],
    });

    await prisma.menuCategory.create({
      data: {
        id: ids.categoryA,
        restaurantId: ids.restaurantA,
        locationId: ids.locationA,
        name: 'Test Category',
        displayOrder: 10,
        status: MenuCategoryStatus.ACTIVE,
      },
    });
  });

  afterAll(async () => {
    await cleanTestRecords();
    await prisma.$disconnect();
  });

  it('enforces globally unique table public IDs', async () => {
    const publicId = randomUUID();
    await prisma.restaurantTable.create({
      data: {
        restaurantId: ids.restaurantA,
        locationId: ids.locationA,
        publicId,
        code: 'PUBLIC-A',
        capacity: 2,
        physicalStatus: TablePhysicalStatus.AVAILABLE,
      },
    });

    await expect(
      prisma.restaurantTable.create({
        data: {
          restaurantId: ids.restaurantB,
          locationId: ids.locationB,
          publicId,
          code: 'PUBLIC-B',
          capacity: 2,
        },
      }),
    ).rejects.toThrow();
  });

  it('enforces table-code uniqueness within a location only', async () => {
    await prisma.restaurantTable.create({
      data: {
        restaurantId: ids.restaurantA,
        locationId: ids.locationA,
        code: 'SHARED-CODE',
        capacity: 4,
      },
    });

    await expect(
      prisma.restaurantTable.create({
        data: {
          restaurantId: ids.restaurantA,
          locationId: ids.locationA,
          code: 'SHARED-CODE',
          capacity: 6,
        },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.restaurantTable.create({
        data: {
          restaurantId: ids.restaurantB,
          locationId: ids.locationB,
          code: 'SHARED-CODE',
          capacity: 6,
        },
      }),
    ).resolves.toBeDefined();
  });

  it('rejects cross-restaurant location and category relationships', async () => {
    await expect(
      prisma.restaurantTable.create({
        data: {
          restaurantId: ids.restaurantB,
          locationId: ids.locationA,
          code: 'WRONG-SCOPE',
          capacity: 2,
        },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.menuItem.create({
        data: {
          restaurantId: ids.restaurantB,
          locationId: ids.locationA,
          categoryId: ids.categoryA,
          name: 'Wrong Scope Item',
          priceAmount: 1_000n,
          fulfillmentStation: FulfillmentStation.KITCHEN,
          status: MenuItemStatus.ACTIVE,
        },
      }),
    ).rejects.toThrow();
  });

  it('requires positive capacity and non-negative versions', async () => {
    await expect(
      prisma.restaurantTable.create({
        data: {
          restaurantId: ids.restaurantA,
          locationId: ids.locationA,
          code: 'ZERO-CAPACITY',
          capacity: 0,
        },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.restaurantTable.create({
        data: {
          restaurantId: ids.restaurantA,
          locationId: ids.locationA,
          code: 'NEGATIVE-VERSION',
          capacity: 2,
          version: -1,
        },
      }),
    ).rejects.toThrow();
  });

  it('requires non-negative menu prices and versions', async () => {
    await expect(
      prisma.menuItem.create({
        data: {
          restaurantId: ids.restaurantA,
          locationId: ids.locationA,
          categoryId: ids.categoryA,
          name: 'Negative Price',
          priceAmount: -1n,
          fulfillmentStation: FulfillmentStation.KITCHEN,
        },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.menuItem.create({
        data: {
          restaurantId: ids.restaurantA,
          locationId: ids.locationA,
          categoryId: ids.categoryA,
          name: 'Negative Version',
          priceAmount: 1_000n,
          fulfillmentStation: FulfillmentStation.KITCHEN,
          version: -1,
        },
      }),
    ).rejects.toThrow();
  });

  it('allows at most one active location per restaurant', async () => {
    await expect(
      prisma.location.update({
        where: { id: ids.locationAInactive },
        data: { isActive: true },
      }),
    ).rejects.toThrow();
  });

  it('seeds deterministic fixtures without duplicates', async () => {
    await seedCatalogFixtures(prisma);
    await seedCatalogFixtures(prisma);

    await expect(
      prisma.restaurant.count({ where: { id: catalogFixtureIds.restaurant } }),
    ).resolves.toBe(1);
    await expect(
      prisma.location.count({ where: { id: catalogFixtureIds.location } }),
    ).resolves.toBe(1);
    await expect(
      prisma.restaurantTable.count({ where: { id: { in: [...catalogFixtureIds.tables] } } }),
    ).resolves.toBe(catalogFixtureIds.tables.length);
    await expect(
      prisma.menuCategory.count({ where: { id: { in: [...catalogFixtureIds.categories] } } }),
    ).resolves.toBe(catalogFixtureIds.categories.length);
    await expect(
      prisma.menuItem.count({ where: { id: { in: [...catalogFixtureIds.items] } } }),
    ).resolves.toBe(catalogFixtureIds.items.length);
  });
});
