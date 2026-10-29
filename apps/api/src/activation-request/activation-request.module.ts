import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { GuestSessionModule } from '../guest-session/guest-session.module.js';
import { StaffAuthModule } from '../staff-auth/staff-auth.module.js';
import {
  GuestActivationRequestController,
  StaffActivationRequestController,
} from './activation-request.controller.js';
import { ActivationDecisionService } from './activation-decision.service.js';
import { ActivationClaimService } from './activation-claim.service.js';
import { ActivationRequestService } from './activation-request.service.js';

@Module({
  imports: [DatabaseModule, GuestSessionModule, StaffAuthModule],
  controllers: [GuestActivationRequestController, StaffActivationRequestController],
  providers: [ActivationClaimService, ActivationDecisionService, ActivationRequestService],
})
export class ActivationRequestModule {}
