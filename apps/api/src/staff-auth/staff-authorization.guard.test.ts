import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { StaffAuthorizationGuard } from './staff-authorization.guard.js';

function contextFor(request: object): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => contextFor,
    getClass: () => StaffAuthorizationGuard,
  } as unknown as ExecutionContext;
}

describe('StaffAuthorizationGuard', () => {
  it('allows the required permission only inside the membership location', () => {
    const reflector = {
      getAllAndOverride: vi
        .fn()
        .mockReturnValueOnce(['menu.manage'])
        .mockReturnValueOnce('locationId'),
    } as unknown as Reflector;
    const guard = new StaffAuthorizationGuard(reflector);
    expect(
      guard.canActivate(
        contextFor({
          params: { locationId: 'location-a' },
          staffPrincipal: { locationId: 'location-a', permissions: ['menu.manage'] },
        }),
      ),
    ).toBe(true);
  });

  it.each([
    ['missing permission', { locationId: 'location-a', permissions: [] }, 'location-a'],
    ['wrong scope', { locationId: 'location-a', permissions: ['menu.manage'] }, 'location-b'],
  ])('denies %s', (_label, principal, requestedLocation) => {
    const reflector = {
      getAllAndOverride: vi
        .fn()
        .mockReturnValueOnce(['menu.manage'])
        .mockReturnValueOnce('locationId'),
    } as unknown as Reflector;
    const guard = new StaffAuthorizationGuard(reflector);
    expect(() =>
      guard.canActivate(
        contextFor({ params: { locationId: requestedLocation }, staffPrincipal: principal }),
      ),
    ).toThrow(ForbiddenException);
  });
});
