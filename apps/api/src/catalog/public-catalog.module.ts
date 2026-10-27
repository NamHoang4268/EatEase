import { Module } from '@nestjs/common';
import { PublicCatalogController } from './public-catalog.controller.js';
import { PublicCatalogService } from './public-catalog.service.js';

@Module({ controllers: [PublicCatalogController], providers: [PublicCatalogService] })
export class PublicCatalogModule {}
