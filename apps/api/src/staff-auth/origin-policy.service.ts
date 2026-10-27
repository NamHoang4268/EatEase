import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { loadEnvironment } from '../config/environment.js';

export function isTrustedOrigin(
  origin: string | undefined,
  trustedOrigins: readonly string[],
): boolean {
  return origin !== undefined && trustedOrigins.includes(origin);
}

@Injectable()
export class OriginPolicyService {
  private readonly trustedOrigins = loadEnvironment().TRUSTED_WEB_ORIGINS;

  assertTrusted(request: Request): void {
    if (!isTrustedOrigin(request.headers.origin, this.trustedOrigins)) {
      throw new ForbiddenException({
        code: 'UNTRUSTED_ORIGIN',
        message: 'Request origin is not allowed.',
        details: {},
      });
    }
  }
}
