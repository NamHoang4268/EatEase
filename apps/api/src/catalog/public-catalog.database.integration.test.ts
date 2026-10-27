import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FoundationExceptionFilter } from '../common/filters/foundation-exception.filter.js';
import { PrismaService } from '../database/prisma.service.js';
import { PrismaClient } from '../generated/prisma/client.js';
import {
  FulfillmentStation,
  MenuCategoryStatus,
  MenuItemStatus,
  RestaurantStatus,
} from '../generated/prisma/enums.js';
import { catalogFixtureIds, seedCatalogFixtures } from './catalog.fixtures.js';
import { PublicCatalogController } from './public-catalog.controller.js';
import { PublicCatalogService } from './public-catalog.service.js';

const databaseUrlValue = process.env.DATABASE_URL;

if (!databaseUrlValue) {
  throw new Error('DATABASE_URL is required for public catalog integration tests.');
}

const databaseUrl = new URL(databaseUrlValue);
const databaseName = databaseUrl.pathname.replace(/^\//, '');
const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(databaseUrl.hostname);

if (!isLocalHost || (databaseName !== 'eatease_m2_test' && process.env.CI !== 'true')) {
  throw new Error(
    'Public catalog integration tests require the isolated local eatease_m2_test database or an ephemeral CI database.',
  );
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrlValue, max: 2 }),
});

const otherIds = {
  restaurant: '71000000-0000-4000-8000-000000000001',
  location: '72000000-0000-4000-8000-000000000001',
  table: '73000000-0000-4000-8000-000000000001',
  tablePublic: '73100000-0000-4000-8000-000000000001',
  category: '74000000-0000-4000-8000-000000000001',
  item: '75000000-0000-4000-8000-000000000001',
  inactiveRestaurant: '71000000-0000-4000-8000-000000000002',
  inactiveLocation: '72000000-0000-4000-8000-000000000002',
  inactiveTable: '73000000-0000-4000-8000-000000000002',
  inactiveTablePublic: '73100000-0000-4000-8000-000000000002',
} as const;

const testRestaurantIds = [
  catalogFixtureIds.restaurant,
  otherIds.restaurant,
  otherIds.inactiveRestaurant,
];

async function cleanRecords(): Promise<void> {
  await prisma.menuItem.deleteMany({ where: { restaurantId: { in: testRestaurantIds } } });
  await prisma.menuCategory.deleteMany({ where: { restaurantId: { in: testRestaurantIds } } });
  await prisma.restaurantTable.deleteMany({ where: { restaurantId: { in: testRestaurantIds } } });
  await prisma.location.deleteMany({ where: { restaurantId: { in: testRestaurantIds } } });
  await prisma.restaurant.deleteMany({ where: { id: { in: testRestaurantIds } } });
}

describe('public catalog API', () => {
  let application: INestApplication | undefined;
  let server: Server;

  beforeAll(async () => {
    await prisma.$connect();
    await cleanRecords();
    await seedCatalogFixtures(prisma);

    await prisma.restaurant.create({
      data: {
        id: otherIds.restaurant,
        name: 'Nhà hàng scope khác',
        status: RestaurantStatus.ACTIVE,
      },
    });
    await prisma.location.create({
      data: {
        id: otherIds.location,
        restaurantId: otherIds.restaurant,
        code: 'OTHER',
        name: 'Chi nhánh khác',
        isActive: true,
      },
    });
    await prisma.restaurantTable.create({
      data: {
        id: otherIds.table,
        restaurantId: otherIds.restaurant,
        locationId: otherIds.location,
        publicId: otherIds.tablePublic,
        code: 'X01',
        capacity: 2,
      },
    });
    await prisma.menuCategory.create({
      data: {
        id: otherIds.category,
        restaurantId: otherIds.restaurant,
        locationId: otherIds.location,
        name: 'Danh mục scope khác',
        displayOrder: 1,
        status: MenuCategoryStatus.ACTIVE,
      },
    });
    await prisma.menuItem.create({
      data: {
        id: otherIds.item,
        restaurantId: otherIds.restaurant,
        locationId: otherIds.location,
        categoryId: otherIds.category,
        name: 'Món scope khác',
        priceAmount: 999_000n,
        fulfillmentStation: FulfillmentStation.KITCHEN,
        status: MenuItemStatus.ACTIVE,
      },
    });

    await prisma.restaurant.create({
      data: {
        id: otherIds.inactiveRestaurant,
        name: 'Nhà hàng ngừng hoạt động',
        status: RestaurantStatus.INACTIVE,
      },
    });
    await prisma.location.create({
      data: {
        id: otherIds.inactiveLocation,
        restaurantId: otherIds.inactiveRestaurant,
        code: 'INACTIVE',
        name: 'Chi nhánh ngừng hoạt động',
        isActive: true,
      },
    });
    await prisma.restaurantTable.create({
      data: {
        id: otherIds.inactiveTable,
        restaurantId: otherIds.inactiveRestaurant,
        locationId: otherIds.inactiveLocation,
        publicId: otherIds.inactiveTablePublic,
        code: 'I01',
        capacity: 2,
      },
    });

    const testingModule = await Test.createTestingModule({
      controllers: [PublicCatalogController],
      providers: [PublicCatalogService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    application = testingModule.createNestApplication();
    application.setGlobalPrefix('api/v1');
    application.useGlobalFilters(new FoundationExceptionFilter());
    await application.init();
    server = application.getHttpServer() as Server;
  });

  afterAll(async () => {
    await application?.close();
    await cleanRecords();
    await prisma.$disconnect();
  });

  it('resolves safe public table context without internal scope IDs', async () => {
    const response = await request(server)
      .get(`/api/v1/public/tables/${catalogFixtureIds.tablePublicIds[0]}`)
      .expect(200);

    expect(response.body).toEqual({
      data: {
        publicId: catalogFixtureIds.tablePublicIds[0],
        restaurantName: 'Bếp Mây Demo',
        locationName: 'Chi nhánh Demo',
        tableLabel: 'A01',
        capacity: 2,
        availability: 'AVAILABLE',
      },
    });
    expect(JSON.stringify(response.body)).not.toContain(catalogFixtureIds.restaurant);
    expect(JSON.stringify(response.body)).not.toContain(catalogFixtureIds.location);
  });

  it('returns only active menu data in deterministic order and isolates scope', async () => {
    const response = await request(server)
      .get(`/api/v1/public/menu?tablePublicId=${catalogFixtureIds.tablePublicIds[0]}`)
      .expect(200);
    const body = response.body as {
      data: { categories: Array<{ name: string; items: Array<Record<string, unknown>> }> };
    };

    expect(body.data.categories.map((category) => category.name)).toEqual([
      'Món Việt',
      'Món nhẹ',
      'Đồ uống',
    ]);
    expect(body.data.categories[0]?.items[0]).toMatchObject({
      name: 'Bún bò rau thơm',
      priceAmount: '85000',
      currency: 'VND',
      available: true,
    });
    expect(JSON.stringify(response.body)).not.toContain('Món scope khác');
  });

  it('returns a generic safe error for unknown and inactive table contexts', async () => {
    for (const publicId of ['73100000-0000-4000-8000-000000000099', otherIds.inactiveTablePublic]) {
      const response = await request(server).get(`/api/v1/public/tables/${publicId}`).expect(404);
      const body = response.body as {
        error: { code: string; message: string; requestId: string };
      };
      expect(body.error).toMatchObject({
        code: 'PUBLIC_TABLE_NOT_FOUND',
        message: 'Không tìm thấy bàn đang hoạt động.',
      });
      expect(body.error.requestId).toEqual(expect.any(String));
    }
  });
});
