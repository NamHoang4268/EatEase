import {
  FulfillmentStation,
  MenuCategoryStatus,
  MenuItemStatus,
  RestaurantStatus,
  TablePhysicalStatus,
} from '../generated/prisma/enums.js';
import type { PrismaClient } from '../generated/prisma/client.js';

export const catalogFixtureIds = {
  restaurant: '10000000-0000-4000-8000-000000000001',
  location: '20000000-0000-4000-8000-000000000001',
  tables: [
    '30000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000003',
    '30000000-0000-4000-8000-000000000004',
  ],
  tablePublicIds: [
    '31000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000002',
    '31000000-0000-4000-8000-000000000003',
    '31000000-0000-4000-8000-000000000004',
  ],
  categories: [
    '40000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000002',
    '40000000-0000-4000-8000-000000000003',
  ],
  items: [
    '50000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000002',
    '50000000-0000-4000-8000-000000000003',
    '50000000-0000-4000-8000-000000000004',
    '50000000-0000-4000-8000-000000000005',
    '50000000-0000-4000-8000-000000000006',
  ],
} as const;

const tableFixtures = [
  {
    id: catalogFixtureIds.tables[0],
    publicId: catalogFixtureIds.tablePublicIds[0],
    code: 'A01',
    capacity: 2,
  },
  {
    id: catalogFixtureIds.tables[1],
    publicId: catalogFixtureIds.tablePublicIds[1],
    code: 'A02',
    capacity: 4,
  },
  {
    id: catalogFixtureIds.tables[2],
    publicId: catalogFixtureIds.tablePublicIds[2],
    code: 'B01',
    capacity: 4,
  },
  {
    id: catalogFixtureIds.tables[3],
    publicId: catalogFixtureIds.tablePublicIds[3],
    code: 'B02',
    capacity: 6,
  },
] as const;

const categoryFixtures = [
  { id: catalogFixtureIds.categories[0], name: 'Món Việt', displayOrder: 10 },
  { id: catalogFixtureIds.categories[1], name: 'Món nhẹ', displayOrder: 20 },
  { id: catalogFixtureIds.categories[2], name: 'Đồ uống', displayOrder: 30 },
] as const;

const itemFixtures = [
  {
    id: catalogFixtureIds.items[0],
    categoryId: catalogFixtureIds.categories[0],
    name: 'Cơm gà lá chanh',
    description: 'Cơm thơm, gà áp chảo và lá chanh.',
    priceAmount: 79_000n,
    fulfillmentStation: FulfillmentStation.KITCHEN,
  },
  {
    id: catalogFixtureIds.items[1],
    categoryId: catalogFixtureIds.categories[0],
    name: 'Bún bò rau thơm',
    description: 'Bún bò vị thanh cùng rau thơm theo mùa.',
    priceAmount: 85_000n,
    fulfillmentStation: FulfillmentStation.KITCHEN,
  },
  {
    id: catalogFixtureIds.items[2],
    categoryId: catalogFixtureIds.categories[1],
    name: 'Gỏi cuốn nấm',
    description: 'Gỏi cuốn rau và nấm, dùng kèm sốt mè.',
    priceAmount: 48_000n,
    fulfillmentStation: FulfillmentStation.DIRECT,
  },
  {
    id: catalogFixtureIds.items[3],
    categoryId: catalogFixtureIds.categories[1],
    name: 'Khoai lang giòn',
    description: 'Khoai lang chiên giòn nhẹ với muối thảo mộc.',
    priceAmount: 42_000n,
    fulfillmentStation: FulfillmentStation.KITCHEN,
  },
  {
    id: catalogFixtureIds.items[4],
    categoryId: catalogFixtureIds.categories[2],
    name: 'Trà sen vàng',
    description: 'Trà sen ủ lạnh với vị ngọt nhẹ.',
    priceAmount: 39_000n,
    fulfillmentStation: FulfillmentStation.BAR,
  },
  {
    id: catalogFixtureIds.items[5],
    categoryId: catalogFixtureIds.categories[2],
    name: 'Nước chanh sả',
    description: 'Chanh tươi, sả và một chút mật ong.',
    priceAmount: 35_000n,
    fulfillmentStation: FulfillmentStation.BAR,
  },
] as const;

export async function seedCatalogFixtures(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    await transaction.restaurant.upsert({
      where: { id: catalogFixtureIds.restaurant },
      create: {
        id: catalogFixtureIds.restaurant,
        name: 'Bếp Mây Demo',
        status: RestaurantStatus.ACTIVE,
      },
      update: { name: 'Bếp Mây Demo', status: RestaurantStatus.ACTIVE },
    });

    await transaction.location.upsert({
      where: { id: catalogFixtureIds.location },
      create: {
        id: catalogFixtureIds.location,
        restaurantId: catalogFixtureIds.restaurant,
        code: 'HCM-DEMO',
        name: 'Chi nhánh Demo',
        timezone: 'Asia/Ho_Chi_Minh',
        currency: 'VND',
        isActive: true,
      },
      update: {
        code: 'HCM-DEMO',
        name: 'Chi nhánh Demo',
        timezone: 'Asia/Ho_Chi_Minh',
        currency: 'VND',
        isActive: true,
      },
    });

    for (const table of tableFixtures) {
      await transaction.restaurantTable.upsert({
        where: { id: table.id },
        create: {
          ...table,
          restaurantId: catalogFixtureIds.restaurant,
          locationId: catalogFixtureIds.location,
          physicalStatus: TablePhysicalStatus.AVAILABLE,
          isActive: true,
        },
        update: {
          publicId: table.publicId,
          code: table.code,
          capacity: table.capacity,
          isActive: true,
        },
      });
    }

    for (const category of categoryFixtures) {
      await transaction.menuCategory.upsert({
        where: { id: category.id },
        create: {
          ...category,
          restaurantId: catalogFixtureIds.restaurant,
          locationId: catalogFixtureIds.location,
          status: MenuCategoryStatus.ACTIVE,
        },
        update: {
          name: category.name,
          displayOrder: category.displayOrder,
          status: MenuCategoryStatus.ACTIVE,
        },
      });
    }

    for (const item of itemFixtures) {
      await transaction.menuItem.upsert({
        where: { id: item.id },
        create: {
          ...item,
          restaurantId: catalogFixtureIds.restaurant,
          locationId: catalogFixtureIds.location,
          status: MenuItemStatus.ACTIVE,
        },
        update: {
          categoryId: item.categoryId,
          name: item.name,
          description: item.description,
          priceAmount: item.priceAmount,
          fulfillmentStation: item.fulfillmentStation,
          status: MenuItemStatus.ACTIVE,
        },
      });
    }
  });
}
