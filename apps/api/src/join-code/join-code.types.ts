import type { GuestPrincipal } from '../guest-session/guest-session.types.js';
import type { StaffPrincipal } from '../staff-auth/staff-auth.types.js';

export type JoinCodeMetadata = {
  hasActiveCode: boolean;
  expiresAt: string | null;
  tableSessionVersion: number;
};

export type IssueJoinCodeData = JoinCodeMetadata & {
  code: string | null;
  plaintextAvailable: boolean;
};

export type JoinTableData = {
  session: {
    accessLevel: 'ORDER_ENABLED';
    tableSessionId: string;
    version: number;
  };
};

export type HostIssueInput = {
  principal: GuestPrincipal;
  expectedVersion: number;
  replaceExisting: boolean;
  idempotencyKey: string;
};

export type StaffIssueInput = {
  principal: StaffPrincipal;
  tableSessionId: string;
  expectedVersion: number;
  replaceExisting: boolean;
  idempotencyKey: string;
};

export type StaffRevokeInput = {
  principal: StaffPrincipal;
  tableSessionId: string;
  expectedVersion: number;
  idempotencyKey: string;
};

export type JoinTableInput = {
  tablePublicId: string;
  joinCode: string;
  idempotencyKey: string;
  rawSessionToken: string;
  rawCsrfToken: string;
  sourceIp: string;
};

export type RotatedGuestResult = {
  data: JoinTableData;
  sessionToken: string;
  csrfToken: string;
  absoluteExpiresAt: Date;
};
