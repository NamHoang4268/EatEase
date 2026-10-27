import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../database/prisma.service.js';
import { FulfillmentStation, TablePhysicalStatus } from '../generated/prisma/enums.js';
import { PublicCatalogService } from './public-catalog.service.js';

function createService() {
  const findFirst = vi.fn();
  const prisma = { restaurantTable: { findFirst } } as unknown as PrismaService;
  return { findFirst, service: new PublicCatalogService(prisma) };
}

describe('PublicCatalogService', () => {
  it('returns only safe public table context and maps occupied tables to browse-only', async () => {
    const { findFirst, service } = createService();
    findFirst.mockResolvedValue({
      publicId: '31000000-0000-4000-8000-000000000001',
      code: 'A01',
      capacity: 2,
      physicalStatus: TablePhysicalStatus.OCCUPIED,
      location: { name: 'Chi nhánh Demo', restaurant: { name: 'Bếp Mây Demo' } },
    });

    await expect(service.resolveTable('31000000-0000-4000-8000-000000000001')).resolves.toEqual({
      publicId: '31000000-0000-4000-8000-000000000001',
      restaurantName: 'Bếp Mây Demo',
      locationName: 'Chi nhánh Demo',
      tableLabel: 'A01',
      capacity: 2,
      availability: 'BROWSE_ONLY',
    });
  });

  it('uses one scoped query and serializes VND BigInt values as decimal strings', async () => {
    const { findFirst, service } = createService();
    findFirst.mockResolvedValue({
      location: {
        currency: 'VND',
        categories: [
          {
            id: '40000000-0000-4000-8000-000000000001',
            name: 'Món Việt',
            items: [
              {
                id: '50000000-0000-4000-8000-000000000001',
                name: 'Cơm gà lá chanh',
                description: null,
                priceAmount: 79_000n,
                fulfillmentStation: FulfillmentStation.KITCHEN,
              },
            ],
          },
        ],
      },
    });

    const result = await service.getMenu('31000000-0000-4000-8000-000000000001');

    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(result.categories[0]?.items[0]).toMatchObject({
      priceAmount: '79000',
      currency: 'VND',
      available: true,
    });
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it('returns the same safe not-found error for unknown or inactive contexts', async () => {
    const { findFirst, service } = createService();
    findFirst.mockResolvedValue(null);

    await expect(
      service.resolveTable('31000000-0000-4000-8000-000000000099'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.getMenu('31000000-0000-4000-8000-000000000099')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
