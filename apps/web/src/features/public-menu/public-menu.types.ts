export type PublicTableContext = {
  publicId: string;
  restaurantName: string;
  locationName: string;
  tableLabel: string;
  capacity: number;
  availability: 'AVAILABLE' | 'BROWSE_ONLY' | 'UNAVAILABLE';
};

export type PublicMenuItem = {
  id: string;
  name: string;
  description: string | null;
  priceAmount: string;
  currency: 'VND';
  fulfillmentStation: 'KITCHEN' | 'BAR' | 'DIRECT';
  available: boolean;
};

export type PublicMenuCategory = {
  id: string;
  name: string;
  items: PublicMenuItem[];
};

export type PublicMenu = {
  currency: 'VND';
  categories: PublicMenuCategory[];
};

export type GuestSessionData = {
  table: PublicTableContext;
  activationState: string;
  session: {
    accessLevel: 'BROWSE_ONLY' | 'ORDER_ENABLED';
    idleExpiresAt: string;
    absoluteExpiresAt: string;
  };
  csrfToken: string;
};

export type ActivationState = {
  status: 'NOT_REQUESTED' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'CANCELLED';
  expiresAt?: string;
  activationRequestId?: string;
  version?: number;
  claimAvailable?: boolean;
};

export type GuestAccessLevel = 'BROWSE_ONLY' | 'ORDER_ENABLED';

export type ClaimActivationResponse = {
  session: {
    accessLevel: 'ORDER_ENABLED';
    tableSessionId: string;
    version: number;
  };
  csrfToken: string;
};
