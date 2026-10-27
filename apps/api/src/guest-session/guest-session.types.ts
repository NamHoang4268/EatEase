import type { Request } from 'express';
import type { PublicTableAvailability } from '../catalog/public-catalog.contract.js';
import type { GuestAccessLevel } from '../generated/prisma/enums.js';

export type GuestPrincipal = {
  sessionId: string;
  restaurantId: string;
  locationId: string;
  tableId: string;
  tablePublicId: string;
  accessLevel: GuestAccessLevel;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  csrfTokenHash: string;
};

export type GuestRequest = Request & { guestPrincipal?: GuestPrincipal };

export type GuestBootstrapTableContext = {
  publicId: string;
  restaurantName: string;
  locationName: string;
  tableLabel: string;
  capacity: number;
  availability: PublicTableAvailability;
};

export type GuestBootstrapResult = {
  sessionToken: string;
  csrfToken: string;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  accessLevel: GuestAccessLevel;
  table: GuestBootstrapTableContext;
  activationState: 'NOT_REQUESTED';
};

