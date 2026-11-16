import { z } from 'zod';

const version = z.number().int().min(0).max(2_147_483_646);
export const cashPaymentBodySchema = z
  .object({ expectedSessionVersion: version, expectedBillVersion: version })
  .strict();

export type CashPaymentInput = z.infer<typeof cashPaymentBodySchema> & {
  tableSessionId: string;
  idempotencyKey: string;
};

export type CashPaymentResult = {
  session: { id: string; status: 'CHECKOUT_LOCKED'; version: number };
  bill: {
    id: string;
    status: 'SETTLED';
    version: number;
    totalAmount: string;
    paidAmount: string;
    balanceAmount: string;
  };
  payment: {
    id: string;
    method: 'CASH';
    status: 'SUCCEEDED';
    amount: string;
    recordedAt: string;
  } | null;
  settlement: { id: string; settledAmount: string; settledAt: string };
};
