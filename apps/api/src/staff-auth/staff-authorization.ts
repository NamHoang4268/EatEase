import { SetMetadata } from '@nestjs/common';
import { LOCATION_PARAMETER, REQUIRED_PERMISSIONS } from './auth.constants.js';

export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);

export const RequireLocationParameter = (parameterName = 'locationId') =>
  SetMetadata(LOCATION_PARAMETER, parameterName);
