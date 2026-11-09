import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { GuestRequest } from '../guest-session/guest-session.types.js';
import type { StaffRequest } from '../staff-auth/staff-auth.types.js';
import { checkoutBodySchema } from './checkout.contract.js';
import { CheckoutController } from './checkout.controller.js';
import type { CheckoutService } from './checkout.service.js';

describe('M4.1 checkout request contract', () => {
  it.each([
    {},
    { expectedSessionVersion: -1, expectedBillVersion: 0 },
    { expectedSessionVersion: 0, expectedBillVersion: 0.5 },
    { expectedSessionVersion: 0, expectedBillVersion: 2_147_483_647 },
    { expectedSessionVersion: 0, expectedBillVersion: 0, amount: '1' },
    { expectedSessionVersion: 0, expectedBillVersion: 0, tableSessionId: randomUUID() },
  ])('rejects invalid versions or client-controlled financial/scope fields: %j', (body) => {
    expect(checkoutBodySchema.safeParse(body).success).toBe(false);
  });

  it('derives Guest target from the principal and trims the idempotency key', async () => {
    const checkoutGuest = vi.fn();
    const controller = new CheckoutController({ checkoutGuest } as unknown as CheckoutService);
    const principal = { tableSessionId: randomUUID(), accessLevel: 'ORDER_ENABLED' };
    const body = { expectedSessionVersion: 2, expectedBillVersion: 3 };
    await controller.guest({ guestPrincipal: principal } as GuestRequest, body, ' key ');
    expect(checkoutGuest).toHaveBeenCalledWith(principal, {
      ...body,
      tableSessionId: principal.tableSessionId,
      idempotencyKey: 'key',
    });
    await expect(
      controller.guest(
        { guestPrincipal: { ...principal, accessLevel: 'BROWSE_ONLY' } } as GuestRequest,
        body,
        'key',
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('rejects invalid IDs/keys before invoking staff mutations', async () => {
    const resume = vi.fn();
    const controller = new CheckoutController({ resume } as unknown as CheckoutService);
    const request = { staffPrincipal: {} } as StaffRequest;
    const body = { expectedSessionVersion: 0, expectedBillVersion: 0 };
    await expect(controller.resume(request, 'foreign', body, 'key')).rejects.toMatchObject({
      status: 400,
    });
    await expect(controller.resume(request, randomUUID(), body, ' ')).rejects.toMatchObject({
      status: 400,
    });
    expect(resume).not.toHaveBeenCalled();
  });
});
