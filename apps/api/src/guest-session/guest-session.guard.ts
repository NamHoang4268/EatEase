import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { GuestCookieService } from './guest-cookie.service.js';
import { GuestSessionService } from './guest-session.service.js';
import type { GuestRequest } from './guest-session.types.js';

@Injectable()
export class GuestSessionGuard implements CanActivate {
  constructor(
    @Inject(GuestCookieService) private readonly cookies: GuestCookieService,
    @Inject(GuestSessionService) private readonly sessions: GuestSessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<GuestRequest>();
    const principal = await this.sessions.authenticate(this.cookies.read(request));
    if (!principal) {
      throw new UnauthorizedException({
        code: 'GUEST_SESSION_INVALID',
        message: 'Guest session is missing, expired, or revoked.',
        details: {},
      });
    }
    request.guestPrincipal = principal;
    return true;
  }
}

