import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { GuestSessionModule } from '../guest-session/guest-session.module.js';
import { StaffAuthModule } from '../staff-auth/staff-auth.module.js';
import { OrderingController } from './ordering.controller.js';
import { OrderPersistence } from './order-persistence.js';
import { OrderingService } from './ordering.service.js';

@Module({
  imports: [DatabaseModule, GuestSessionModule, StaffAuthModule],
  controllers: [OrderingController],
  providers: [OrderPersistence, OrderingService],
})
export class OrderingModule {}
