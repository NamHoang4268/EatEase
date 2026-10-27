import { Module } from '@nestjs/common';
import { PublicCatalogModule } from './catalog/public-catalog.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';

@Module({ imports: [DatabaseModule, HealthModule, PublicCatalogModule] })
export class AppModule {}
