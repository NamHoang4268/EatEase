import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { GuestSessionModule } from '../guest-session/guest-session.module.js';
import { StaffAuthModule } from '../staff-auth/staff-auth.module.js';
import { GuestJoinCodeController, StaffJoinCodeController } from './join-code.controller.js';
import { JoinCodeService } from './join-code.service.js';

@Module({
  imports: [DatabaseModule, GuestSessionModule, StaffAuthModule],
  controllers: [GuestJoinCodeController, StaffJoinCodeController],
  providers: [JoinCodeService],
})
export class JoinCodeModule {}
