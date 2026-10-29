import type { GuestPrincipal } from '../guest-session/guest-session.types.js';
import type { StaffPrincipal } from '../staff-auth/staff-auth.types.js';

export type ActivationGuestState =
  'NOT_REQUESTED' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'CANCELLED';

export type ActivationGuestResponse = {
  status: ActivationGuestState;
  expiresAt?: string;
  activationRequestId?: string;
  version?: number;
  claimAvailable?: boolean;
};

export type ActivationCommandResult = {
  statusCode: 200 | 202;
  data: ActivationGuestResponse;
};

export type RequestActivationInput = {
  tablePublicId: string;
  idempotencyKey: string;
  principal: GuestPrincipal;
};

export type StaffActivationQueueItem = {
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

export type StaffActivationQueueInput = {
  status: 'PENDING';
  principal: StaffPrincipal;
};

type StaffActivationDecisionBase = {
  activationRequestId: string;
  expectedVersion: number;
  idempotencyKey: string;
  principal: StaffPrincipal;
};

export type ApproveActivationInput = StaffActivationDecisionBase & {
  physicalPresenceConfirmed: true;
};

export type RejectActivationInput = StaffActivationDecisionBase & {
  reason: string;
};

export type ApproveActivationResponse = {
  activationRequest: {
    id: string;
    status: 'APPROVED';
    version: number;
    handledAt: string;
  };
  table: {
    publicId: string;
    physicalStatus: 'OCCUPIED';
    version: number;
  };
  tableSession: {
    id: string;
    status: 'ACTIVE';
    version: number;
  };
  bill: {
    id: string;
    status: 'OPEN';
    subtotalAmount: string;
    adjustmentAmount: string;
    totalAmount: string;
    paidAmount: string;
    balanceAmount: string;
    version: number;
  };
};

export type RejectActivationResponse = {
  activationRequest: {
    id: string;
    status: 'REJECTED';
    version: number;
    handledAt: string;
    rejectionReason: string;
  };
};

export type ClaimActivationInput = {
  expectedVersion: number;
  idempotencyKey: string;
  rawSessionToken: string;
  rawCsrfToken: string;
};

export type ClaimActivationData = {
  session: {
    accessLevel: 'ORDER_ENABLED';
    tableSessionId: string;
    version: number;
  };
};

export type ClaimActivationResult = {
  data: ClaimActivationData;
  sessionToken: string;
  csrfToken: string;
  absoluteExpiresAt: Date;
};
