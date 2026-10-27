import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { LOCATION_PARAMETER, REQUIRED_PERMISSIONS } from './auth.constants.js';
import type { StaffRequest } from './staff-auth.types.js';

@Injectable()
export class StaffAuthorizationGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<StaffRequest>();
    const principal = request.staffPrincipal;
    const permissions = this.reflector.getAllAndOverride<readonly string[]>(REQUIRED_PERMISSIONS, [
      context.getHandler(),
      context.getClass(),
    ]);
    const locationParameter = this.reflector.getAllAndOverride<string>(LOCATION_PARAMETER, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!principal || !permissions || permissions.length === 0) return this.deny();
    if (!permissions.every((permission) => principal.permissions.includes(permission))) {
      return this.deny();
    }
    if (locationParameter && request.params[locationParameter] !== principal.locationId) {
      return this.deny();
    }
    return true;
  }

  private deny(): never {
    throw new ForbiddenException({
      code: 'STAFF_AUTHORIZATION_DENIED',
      message: 'You are not authorized for this resource.',
      details: {},
    });
  }
}
