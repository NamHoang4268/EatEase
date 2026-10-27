import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { tokensMatch } from './auth.crypto.js';
import { OriginPolicyService } from './origin-policy.service.js';
import type { StaffRequest } from './staff-auth.types.js';

@Injectable()
export class StaffCsrfGuard implements CanActivate {
  constructor(@Inject(OriginPolicyService) private readonly origins: OriginPolicyService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<StaffRequest>();
    this.origins.assertTrusted(request);
    const tokenHeader = request.headers['x-csrf-token'];
    const token = Array.isArray(tokenHeader) ? undefined : tokenHeader;
    if (
      !request.staffPrincipal ||
      !token ||
      !tokensMatch(token, request.staffPrincipal.csrfTokenHash)
    ) {
      throw new ForbiddenException({
        code: 'STAFF_CSRF_INVALID',
        message: 'CSRF validation failed.',
        details: {},
      });
    }
    return true;
  }
}
