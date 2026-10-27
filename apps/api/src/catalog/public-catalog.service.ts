import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  MenuCategoryStatus,
  MenuItemStatus,
  RestaurantStatus,
  TablePhysicalStatus,
} from '../generated/prisma/enums.js';
import { PrismaService } from '../database/prisma.service.js';
import type {
  PublicMenu,
  PublicTableAvailability,
  PublicTableContext,
} from './public-catalog.contract.js';

const publicTableWhere = (publicId: string) => ({
  publicId,
  isActive: true,
  location: {
    isActive: true,
    restaurant: { status: RestaurantStatus.ACTIVE },
  },
});

function tableNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'PUBLIC_TABLE_NOT_FOUND',
    message: 'Không tìm thấy bàn đang hoạt động.',
    details: {},
  });
}

function mapAvailability(status: TablePhysicalStatus): PublicTableAvailability {
  switch (status) {
    case TablePhysicalStatus.AVAILABLE:
      return 'AVAILABLE';
    case TablePhysicalStatus.OCCUPIED:
      return 'BROWSE_ONLY';
    case TablePhysicalStatus.CLEANING:
    case TablePhysicalStatus.OUT_OF_SERVICE:
      return 'UNAVAILABLE';
  }
}

@Injectable()
export class PublicCatalogService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async resolveTable(publicId: string): Promise<PublicTableContext> {
    const table = await this.prisma.restaurantTable.findFirst({
      where: publicTableWhere(publicId),
      select: {
        publicId: true,
        code: true,
        capacity: true,
        physicalStatus: true,
        location: {
          select: {
            name: true,
            restaurant: { select: { name: true } },
          },
        },
      },
    });

    if (!table) {
      throw tableNotFound();
    }

    return {
      publicId: table.publicId,
      restaurantName: table.location.restaurant.name,
      locationName: table.location.name,
      tableLabel: table.code,
      capacity: table.capacity,
      availability: mapAvailability(table.physicalStatus),
    };
  }

  async getMenu(publicId: string): Promise<PublicMenu> {
    const table = await this.prisma.restaurantTable.findFirst({
      where: publicTableWhere(publicId),
      select: {
        location: {
          select: {
            currency: true,
            categories: {
              where: { status: MenuCategoryStatus.ACTIVE },
              orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
              select: {
                id: true,
                name: true,
                items: {
                  where: { status: MenuItemStatus.ACTIVE },
                  orderBy: [{ name: 'asc' }, { id: 'asc' }],
                  select: {
                    id: true,
                    name: true,
                    description: true,
                    priceAmount: true,
                    fulfillmentStation: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!table) {
      throw tableNotFound();
    }

    return {
      currency: 'VND',
      categories: table.location.categories.map((category) => ({
        id: category.id,
        name: category.name,
        items: category.items.map((item) => ({
          id: item.id,
          name: item.name,
          description: item.description,
          priceAmount: item.priceAmount.toString(),
          currency: 'VND',
          fulfillmentStation: item.fulfillmentStation,
          available: true,
        })),
      })),
    };
  }
}
