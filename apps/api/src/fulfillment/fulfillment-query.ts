import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

const cursorSchema = z.object({ submittedAt: z.iso.datetime(), itemId: z.uuid() }).strict();
const querySchema = z
  .object({
    status: z.literal('NEW').default('NEW'),
    station: z.enum(['KITCHEN', 'BAR', 'DIRECT']).optional(),
    limit: z
      .string()
      .regex(/^\d{1,3}$/)
      .transform(Number)
      .pipe(z.number().min(1).max(100))
      .default(50),
    cursor: z
      .string()
      .min(1)
      .max(256)
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional(),
  })
  .strict();

export type QueueCursor = z.output<typeof cursorSchema>;
export type FulfillmentQuery = Omit<z.output<typeof querySchema>, 'cursor'> & {
  cursor?: QueueCursor;
};

export function encodeQueueCursor(cursor: QueueCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function parseFulfillmentQuery(value: unknown): FulfillmentQuery {
  const invalid = () =>
    new BadRequestException({
      code: 'FULFILLMENT_QUERY_INVALID',
      message: 'Invalid fulfillment queue query.',
      details: {},
    });
  const parsed = querySchema.safeParse(value);
  if (!parsed.success) throw invalid();
  const { cursor, ...query } = parsed.data;
  if (!cursor) return query;
  try {
    const decoded = cursorSchema.parse(
      JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')),
    );
    return { ...query, cursor: decoded };
  } catch {
    throw invalid();
  }
}
