import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { GuestSessionModule } from '../guest-session/guest-session.module.js';
import { StaffAuthModule } from '../staff-auth/staff-auth.module.js';
import { CancellationController } from './cancellation.controller.js';
import { CancellationService } from './cancellation.service.js';

@Module({
  imports: [DatabaseModule, GuestSessionModule, StaffAuthModule],
  controllers: [CancellationController],
  providers: [CancellationService],
})
export class CancellationModule {}
