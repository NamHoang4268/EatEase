import { z } from 'zod';

const version = z.number().int().min(0).max(2_147_483_646);
export const checkoutBodySchema = z
  .object({
    expectedSessionVersion: version,
    expectedBillVersion: version,
  })
  .strict();
export type CheckoutBody = z.infer<typeof checkoutBodySchema>;
export type CheckoutResult = {
  session: {
    id: string;
    status: 'ACTIVE' | 'CHECKOUT_LOCKED';
    version: number;
    checkoutLockedAt: string | null;
  };
  bill: { id: string; status: 'OPEN' | 'PAYMENT_PENDING'; version: number };
};
