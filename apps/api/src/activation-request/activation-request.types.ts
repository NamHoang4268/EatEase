import type { GuestPrincipal } from '../guest-session/guest-session.types.js';
import type { StaffPrincipal } from '../staff-auth/staff-auth.types.js';

export type ActivationGuestState =
  'NOT_REQUESTED' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'CANCELLED';

export type ActivationGuestResponse = {
  status: ActivationGuestState;
  expiresAt?: string;
  activationRequestId?: string;
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
