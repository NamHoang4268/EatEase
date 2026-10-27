import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { tokensMatch } from '../staff-auth/auth.crypto.js';
import { OriginPolicyService } from '../staff-auth/origin-policy.service.js';
import type { GuestRequest } from './guest-session.types.js';

@Injectable()
export class GuestCsrfGuard implements CanActivate {
  constructor(@Inject(OriginPolicyService) private readonly origins: OriginPolicyService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<GuestRequest>();
    this.origins.assertTrusted(request);
    const tokenHeader = request.headers['x-csrf-token'];
    const token = Array.isArray(tokenHeader) ? undefined : tokenHeader;
    if (
      !request.guestPrincipal ||
      !token ||
      !tokensMatch(token, request.guestPrincipal.csrfTokenHash)
    ) {
      throw new ForbiddenException({
        code: 'GUEST_CSRF_INVALID',
        message: 'CSRF validation failed.',
        details: {},
      });
    }
    return true;
  }
}

