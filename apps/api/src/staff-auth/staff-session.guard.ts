import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { StaffCookieService } from './staff-cookie.service.js';
import type { StaffRequest } from './staff-auth.types.js';
import { StaffSessionService } from './staff-session.service.js';

@Injectable()
export class StaffSessionGuard implements CanActivate {
  constructor(
    @Inject(StaffCookieService) private readonly cookies: StaffCookieService,
    @Inject(StaffSessionService) private readonly sessions: StaffSessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<StaffRequest>();
    const principal = await this.sessions.authenticate(this.cookies.read(request));
    if (!principal) {
      throw new UnauthorizedException({
        code: 'STAFF_SESSION_INVALID',
        message: 'Staff session is missing, expired, or revoked.',
        details: {},
      });
    }
    request.staffPrincipal = principal;
    return true;
  }
}
