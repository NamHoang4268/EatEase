import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

const inputSchema = z.object({
  itemId: z.uuid(),
  body: z.object({ expectedVersion: z.number().int().min(0).max(2_147_483_646) }).strict(),
  key: z.string().trim().min(1).max(128),
});

export function parseFulfillmentTransition(itemId: unknown, body: unknown, key: unknown) {
  const parsed = inputSchema.safeParse({ itemId, body, key });
  if (!parsed.success) throw new BadRequestException({ code: 'FULFILLMENT_REQUEST_INVALID' });
  return {
    itemId: parsed.data.itemId,
    expectedVersion: parsed.data.body.expectedVersion,
    idempotencyKey: parsed.data.key,
  };
}
