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

export type JoinTableResponse = ClaimActivationResponse;

export type JoinCodeMetadata = {
  hasActiveCode: boolean;
  expiresAt: string | null;
  tableSessionVersion: number;
};

export type IssuedJoinCode = JoinCodeMetadata & {
  code: string | null;
  plaintextAvailable: boolean;
};

export type ConsolidatedSessionView = {
  session: {
    id: string;
    status: 'ACTIVE' | 'CHECKOUT_LOCKED';
    version: number;
    table: { publicId: string; code: string };
  };
  orders: Array<{
    id: string;
    orderNumber: string;
    source: 'QR_GUEST' | 'STAFF_WAITER';
    status: 'SUBMITTED';
    submittedAt: string;
    items: Array<{
      id: string;
      nameSnapshot: string;
      quantity: number;
      unitPriceAmount: string;
      lineAmount: string;
      status: string;
      stationSnapshot: 'KITCHEN' | 'BAR' | 'DIRECT';
      note: string | null;
      version: number;
      cancellationRequest: {
        id: string;
        status: 'PENDING_WAITER' | 'PENDING_KITCHEN' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';
        version: number;
        requestReason: string;
        decisionReason: string | null;
        createdAt: string;
        decidedAt: string | null;
      } | null;
    }>;
  }>;
  bill: {
    id: string;
    status: string;
    subtotalAmount: string;
    adjustmentAmount: string;
    totalAmount: string;
    paidAmount: string;
    balanceAmount: string;
    version: number;
    lines: Array<{
      id: string;
      orderItemId: string;
      descriptionSnapshot: string;
      quantity: number;
      unitAmount: string;
      lineAmount: string;
    }>;
    adjustments: Array<{
      id: string;
      orderItemId: string;
      kind: 'FULL_CANCELLATION_WAIVER' | 'FULL_MANAGER_WAIVER';
      amount: string;
      reason: string;
      createdAt: string;
    }>;
  };
};
