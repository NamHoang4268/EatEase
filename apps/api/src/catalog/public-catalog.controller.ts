import { Controller, Get, Inject, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import type { PublicMenu, PublicTableContext } from './public-catalog.contract.js';
import { PublicCatalogService } from './public-catalog.service.js';

@Controller('public')
export class PublicCatalogController {
  constructor(@Inject(PublicCatalogService) private readonly publicCatalog: PublicCatalogService) {}

  @Get('tables/:publicId')
  async resolveTable(
    @Param('publicId', new ParseUUIDPipe({ version: '4' })) publicId: string,
  ): Promise<{ data: PublicTableContext }> {
    return { data: await this.publicCatalog.resolveTable(publicId) };
  }

  @Get('menu')
  async getMenu(
    @Query('tablePublicId', new ParseUUIDPipe({ version: '4' })) tablePublicId: string,
  ): Promise<{ data: PublicMenu }> {
    return { data: await this.publicCatalog.getMenu(tablePublicId) };
  }
}
