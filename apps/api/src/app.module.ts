import { Module } from '@nestjs/common';
import { ActivationRequestModule } from './activation-request/activation-request.module.js';
import { PublicCatalogModule } from './catalog/public-catalog.module.js';
import { DatabaseModule } from './database/database.module.js';
import { GuestSessionModule } from './guest-session/guest-session.module.js';
import { FulfillmentModule } from './fulfillment/fulfillment.module.js';
import { HealthModule } from './health/health.module.js';
import { JoinCodeModule } from './join-code/join-code.module.js';
import { OrderingModule } from './ordering/ordering.module.js';
import { StaffAuthModule } from './staff-auth/staff-auth.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { CancellationModule } from './cancellation/cancellation.module.js';

@Module({
  imports: [
    ActivationRequestModule,
    CancellationModule,
    DatabaseModule,
    GuestSessionModule,
    FulfillmentModule,
    HealthModule,
    JoinCodeModule,
    OrderingModule,
    PublicCatalogModule,
    StaffAuthModule,
    RealtimeModule,
  ],
})
export class AppModule {}
