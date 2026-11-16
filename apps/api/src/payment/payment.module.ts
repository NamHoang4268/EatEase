import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { StaffAuthModule } from '../staff-auth/staff-auth.module.js';
import { CashPaymentController } from './cash-payment.controller.js';
import { CashPaymentService } from './cash-payment.service.js';

@Module({
  imports: [DatabaseModule, StaffAuthModule],
  controllers: [CashPaymentController],
  providers: [CashPaymentService],
})
export class PaymentModule {}
