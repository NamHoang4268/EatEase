export type StaffIdentity = {
  id: string;
  email: string;
  name: string;
  membershipId: string;
  restaurantId: string;
  locationId: string;
  permissions: string[];
};

export type StaffActivationRequest = {
  id: string;
  status: 'PENDING';
  createdAt: string;
  expiresAt: string;
  version: number;
  table: {
    publicId: string;
    code: string;
    capacity: number;
  };
};

export type StaffActiveTableSession = {
  id: string;
  version: number;
  activatedAt: string;
  table: { publicId: string; code: string; capacity: number };
  joinCode: { hasActiveCode: boolean; expiresAt: string | null };
};

export type ApiErrorPayload = {
  error?: {
    code?: string;
    message?: string;
  };
};
