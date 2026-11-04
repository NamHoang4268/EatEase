import { z } from 'zod';

export const submitOrderBodySchema = z
  .object({
    items: z
      .array(
        z
          .object({
            menuItemId: z.uuid(),
            quantity: z.number().int().positive().max(2_147_483_647),
            modifierSelections: z.array(z.never()).default([]),
            note: z.string().nullable().optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export type SubmitOrderBody = z.output<typeof submitOrderBodySchema>;

export type ConsolidatedSessionView = {
  session: {
    id: string;
    status: 'ACTIVE';
    activatedAt: string;
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
      stationSnapshot: string;
      note: string | null;
      version: number;
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
  };
};
