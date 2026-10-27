import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { hashToken } from '../staff-auth/auth.crypto.js';
import type { OriginPolicyService } from '../staff-auth/origin-policy.service.js';
import { GuestCsrfGuard } from './guest-csrf.guard.js';

function createMockContext(request: object): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('GuestCsrfGuard', () => {
  const assertTrustedMock = vi.fn();
  const originPolicy = {
    assertTrusted: assertTrustedMock,
  } as unknown as OriginPolicyService;

  it('allows request with valid origin and matching CSRF token', () => {
    const rawCsrf = 'valid-raw-csrf-token';
    const csrfTokenHash = hashToken(rawCsrf);
    const guard = new GuestCsrfGuard(originPolicy);

    const context = createMockContext({
      headers: { 'x-csrf-token': rawCsrf },
      guestPrincipal: { csrfTokenHash },
    });

    expect(guard.canActivate(context)).toBe(true);
    expect(assertTrustedMock).toHaveBeenCalled();
  });

  it('rejects request with missing or mismatched CSRF token', () => {
    const guard = new GuestCsrfGuard(originPolicy);

    const missingContext = createMockContext({
      headers: {},
      guestPrincipal: { csrfTokenHash: hashToken('token') },
    });
    expect(() => guard.canActivate(missingContext)).toThrow(ForbiddenException);

    const mismatchContext = createMockContext({
      headers: { 'x-csrf-token': 'wrong-token' },
      guestPrincipal: { csrfTokenHash: hashToken('token') },
    });
    expect(() => guard.canActivate(mismatchContext)).toThrow(ForbiddenException);
  });
});
