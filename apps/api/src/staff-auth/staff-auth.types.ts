import type { Request } from 'express';

export type StaffPrincipal = {
  sessionId: string;
  staffUserId: string;
  membershipId: string;
  restaurantId: string;
  locationId: string;
  email: string;
  name: string;
  permissions: readonly string[];
  csrfTokenHash: string;
};

export type StaffRequest = Request & { staffPrincipal?: StaffPrincipal };

export type LoginResult = {
  sessionToken: string;
  csrfToken: string;
  expiresAt: Date;
  staff: {
    id: string;
    email: string;
    name: string;
    membershipId: string;
    restaurantId: string;
    locationId: string;
    permissions: readonly string[];
  };
};
