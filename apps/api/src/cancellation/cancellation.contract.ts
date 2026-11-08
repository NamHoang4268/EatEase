import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

const idSchema = z.uuid();
const keySchema = z.string().trim().min(1).max(128);
const reasonSchema = z.string().trim().min(1).max(500);
const versionSchema = z.number().int().min(0).max(2_147_483_646);

const guestBodySchema = z.object({ expectedVersion: versionSchema, reason: reasonSchema }).strict();
const decisionBodySchema = z
  .object({
    expectedVersion: versionSchema,
    decision: z.enum(['ACCEPT', 'REJECT']),
    reason: reasonSchema,
  })
  .strict();
const forwardBodySchema = z
  .object({ expectedVersion: versionSchema, reason: reasonSchema })
  .strict();
const directRejectionBodySchema = z
  .object({ expectedVersion: versionSchema, reason: reasonSchema })
  .strict();
const managerCorrectionBodySchema = z
  .object({ expectedVersion: versionSchema, reason: reasonSchema })
  .strict();

function invalid(): BadRequestException {
  return new BadRequestException({ code: 'CANCELLATION_REQUEST_INVALID' });
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw invalid();
  return result.data;
}

export function parseGuestCancellation(itemId: unknown, body: unknown, key: unknown) {
  return {
    itemId: parse(idSchema, itemId),
    ...parse(guestBodySchema, body),
    idempotencyKey: parse(keySchema, key),
  };
}

export function parseCancellationDecision(requestId: unknown, body: unknown, key: unknown) {
  return {
    requestId: parse(idSchema, requestId),
    ...parse(decisionBodySchema, body),
    idempotencyKey: parse(keySchema, key),
  };
}

export function parseCancellationForward(requestId: unknown, body: unknown, key: unknown) {
  return {
    requestId: parse(idSchema, requestId),
    ...parse(forwardBodySchema, body),
    idempotencyKey: parse(keySchema, key),
  };
}

export function parseDirectRejection(itemId: unknown, body: unknown, key: unknown) {
  return {
    itemId: parse(idSchema, itemId),
    ...parse(directRejectionBodySchema, body),
    idempotencyKey: parse(keySchema, key),
  };
}

export function parseManagerCorrection(itemId: unknown, body: unknown, key: unknown) {
  return {
    itemId: parse(idSchema, itemId),
    ...parse(managerCorrectionBodySchema, body),
    idempotencyKey: parse(keySchema, key),
  };
}

export type GuestCancellationInput = ReturnType<typeof parseGuestCancellation>;
export type CancellationDecisionInput = ReturnType<typeof parseCancellationDecision>;
export type CancellationForwardInput = ReturnType<typeof parseCancellationForward>;
export type DirectRejectionInput = ReturnType<typeof parseDirectRejection>;
export type ManagerCorrectionInput = ReturnType<typeof parseManagerCorrection>;
