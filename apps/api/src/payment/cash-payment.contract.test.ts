import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { StaffRequest } from '../staff-auth/staff-auth.types.js';
import { REQUIRED_PERMISSIONS } from '../staff-auth/auth.constants.js';
import { CashPaymentController } from './cash-payment.controller.js';
import { cashPaymentBodySchema } from './cash-payment.contract.js';
import type { CashPaymentService } from './cash-payment.service.js';

describe('M4.3 cash payment contract', () => {
  it.each([
    {},
    { expectedSessionVersion: -1, expectedBillVersion: 0 },
    { expectedSessionVersion: 0, expectedBillVersion: 1.5 },
    { expectedSessionVersion: '0', expectedBillVersion: 0 },
    { expectedSessionVersion: 0, expectedBillVersion: 2_147_483_647 },
    ...['amount', 'method', 'billId', 'restaurantId', 'locationId', 'status'].map((field) => ({
      expectedSessionVersion: 1,
      expectedBillVersion: 2,
      [field]: 'untrusted',
    })),
  ])('rejects malformed versions or caller-controlled financial/scope fields: %j', (value) => {
    expect(cashPaymentBodySchema.safeParse(value).success).toBe(false);
  });

  it('requires the explicit cash permission and passes only authenticated actor and validated input', async () => {
    const record = vi.fn().mockResolvedValue({ bill: { status: 'SETTLED' } });
    const controller = new CashPaymentController({ record } as unknown as CashPaymentService);
    const principal = { membershipId: randomUUID() };
    const sessionId = randomUUID();
    const body = { expectedSessionVersion: 1, expectedBillVersion: 2 };
    const handler: unknown = Object.getOwnPropertyDescriptor(
      CashPaymentController.prototype,
      'record',
    )?.value;
    if (typeof handler !== 'function') throw new Error('Missing cash-payment handler');
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS, handler)).toEqual(['payment.cash_record']);
    const result = await controller.record(
      { staffPrincipal: principal } as StaffRequest,
      sessionId,
      body,
      ' key ',
    );
    expect(record).toHaveBeenCalledWith(principal, {
      ...body,
      tableSessionId: sessionId,
      idempotencyKey: 'key',
    });
    expect(result).toEqual({ data: { bill: { status: 'SETTLED' } } });
  });

  it('rejects missing sessions, invalid path IDs and missing/oversized keys before calling the service', async () => {
    const record = vi.fn();
    const controller = new CashPaymentController({ record } as unknown as CashPaymentService);
    const body = { expectedSessionVersion: 1, expectedBillVersion: 2 };
    await expect(
      controller.record({} as StaffRequest, randomUUID(), body, 'key'),
    ).rejects.toMatchObject({ status: 401 });
    for (const [id, key] of [
      ['invalid', 'key'],
      [randomUUID(), undefined],
      [randomUUID(), ' '],
      [randomUUID(), 'x'.repeat(129)],
    ]) {
      await expect(
        controller.record({ staffPrincipal: {} } as StaffRequest, id!, body, key),
      ).rejects.toMatchObject({ response: { code: 'CASH_PAYMENT_REQUEST_INVALID' } });
    }
    expect(record).not.toHaveBeenCalled();
  });
});
