import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { StaffAuthModule } from '../staff-auth/staff-auth.module.js';
import { FulfillmentController } from './fulfillment.controller.js';
import { FulfillmentService } from './fulfillment.service.js';
import { StartPreparationService } from './start-preparation.service.js';

@Module({
  imports: [DatabaseModule, StaffAuthModule],
  controllers: [FulfillmentController],
  providers: [FulfillmentService, StartPreparationService],
})
export class FulfillmentModule {}
