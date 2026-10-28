import { Module } from '@nestjs/common';
import { ActivationRequestModule } from './activation-request/activation-request.module.js';
import { PublicCatalogModule } from './catalog/public-catalog.module.js';
import { DatabaseModule } from './database/database.module.js';
import { GuestSessionModule } from './guest-session/guest-session.module.js';
import { HealthModule } from './health/health.module.js';
import { StaffAuthModule } from './staff-auth/staff-auth.module.js';

@Module({
  imports: [
    ActivationRequestModule,
    DatabaseModule,
    GuestSessionModule,
    HealthModule,
    PublicCatalogModule,
    StaffAuthModule,
  ],
})
export class AppModule {}
