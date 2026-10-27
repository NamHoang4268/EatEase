import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { OriginPolicyService } from '../staff-auth/origin-policy.service.js';
import { GuestCookieService } from './guest-cookie.service.js';
import { GuestCsrfGuard } from './guest-csrf.guard.js';
import { GuestSessionController } from './guest-session.controller.js';
import { GuestSessionGuard } from './guest-session.guard.js';
import { GuestSessionService } from './guest-session.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [GuestSessionController],
  providers: [
    GuestCookieService,
    GuestCsrfGuard,
    GuestSessionGuard,
    GuestSessionService,
    OriginPolicyService,
  ],
  exports: [GuestCookieService, GuestCsrfGuard, GuestSessionGuard, GuestSessionService],
})
export class GuestSessionModule {}

