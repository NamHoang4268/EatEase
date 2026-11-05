import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { StaffAuthModule } from '../staff-auth/staff-auth.module.js';
import { FulfillmentController } from './fulfillment.controller.js';
import { FulfillmentService } from './fulfillment.service.js';
import { FulfillmentTransitionService } from './fulfillment-transition.service.js';

@Module({
  imports: [DatabaseModule, StaffAuthModule],
  controllers: [FulfillmentController],
  providers: [FulfillmentService, FulfillmentTransitionService],
})
export class FulfillmentModule {}
