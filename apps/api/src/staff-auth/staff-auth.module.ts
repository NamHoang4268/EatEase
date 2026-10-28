import { Module } from '@nestjs/common';
import { LoginRateLimiterService } from './login-rate-limiter.service.js';
import { OriginPolicyService } from './origin-policy.service.js';
import { StaffAuthController } from './staff-auth.controller.js';
import { StaffAuthService } from './staff-auth.service.js';
import { StaffAuthorizationGuard } from './staff-authorization.guard.js';
import { StaffCookieService } from './staff-cookie.service.js';
import { StaffCsrfGuard } from './staff-csrf.guard.js';
import { StaffSessionGuard } from './staff-session.guard.js';
import { StaffSessionService } from './staff-session.service.js';

@Module({
  controllers: [StaffAuthController],
  providers: [
    LoginRateLimiterService,
    OriginPolicyService,
    StaffAuthService,
    StaffAuthorizationGuard,
    StaffCookieService,
    StaffCsrfGuard,
    StaffSessionGuard,
    StaffSessionService,
  ],
  exports: [
    StaffAuthorizationGuard,
    StaffCookieService,
    StaffCsrfGuard,
    StaffSessionGuard,
    StaffSessionService,
  ],
})
export class StaffAuthModule {}
