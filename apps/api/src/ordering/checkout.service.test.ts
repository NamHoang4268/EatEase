import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../database/prisma.service.js';
import type { StaffPrincipal } from '../staff-auth/staff-auth.types.js';
import { CheckoutService } from './checkout.service.js';

function setup() {
  const sessionId = randomUUID(),
    billId = randomUUID();
  const principal = {
    sessionId: randomUUID(),
    staffUserId: randomUUID(),
    membershipId: randomUUID(),
    restaurantId: randomUUID(),
    locationId: randomUUID(),
  } as StaffPrincipal;
  const session = {
    id: sessionId,
    status: 'ACTIVE',
    version: 0,
    activatedAt: new Date(Date.now() - 10_000),
  };
  const bill = { id: billId, status: 'OPEN', version: 3, paidAmount: 0n };
  const expiresAt = new Date(Date.now() + 600_000);
  const tx = {
    $queryRaw: vi
      .fn()
      .mockResolvedValueOnce([session])
      .mockResolvedValueOnce([{ id: billId }])
      .mockResolvedValueOnce([{ expiresAt }])
      .mockResolvedValueOnce([{ id: randomUUID() }]),
    bill: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(bill),
      update: vi.fn().mockResolvedValue({ version: 4 }),
    },
    tableSession: {
      update: vi
        .fn()
        .mockResolvedValue({ version: 1, tableId: randomUUID(), checkoutLockedAt: new Date() }),
    },
    order: { count: vi.fn().mockResolvedValue(1) },
    orderItem: {
      findMany: vi
        .fn()
        .mockResolvedValue([
          { id: randomUUID(), status: 'SERVED', billLine: { id: randomUUID() } },
        ]),
    },
    cancellationRequest: { count: vi.fn().mockResolvedValue(0) },
    idempotencyRecord: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
    auditLog: { create: vi.fn() },
    outboxEvent: { createMany: vi.fn() },
  };
  const prisma = {
    $transaction: vi
      .fn()
      .mockImplementation((callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  return {
    service: new CheckoutService(prisma as unknown as PrismaService),
    tx,
    session,
    bill,
    principal,
    input: {
      tableSessionId: sessionId,
      expectedSessionVersion: 0,
      expectedBillVersion: 3,
      idempotencyKey: randomUUID(),
    },
  };
}

describe('M4.1 checkout transaction behavior', () => {
  it('persists only paired state/version updates and atomic audit/outbox/result', async () => {
    const { service, tx, principal, input } = setup();
    const result = await service.checkoutStaff(principal, input);
    expect(tx.bill.update).toHaveBeenCalledWith({
      where: { id: result.bill.id },
      data: { status: 'PAYMENT_PENDING', version: { increment: 1 } },
    });
    expect(tx.tableSession.update).toHaveBeenCalledWith({
      where: { id: input.tableSessionId },
      data: {
        status: 'CHECKOUT_LOCKED',
        checkoutLockedAt: expect.any(Date) as unknown,
        version: { increment: 1 },
      },
    });
    expect(tx.auditLog.create).toHaveBeenCalledOnce();
    const eventCall = tx.outboxEvent.createMany.mock.calls[0] as unknown as [
      { data: Array<{ eventType: string }> },
    ];
    expect(eventCall[0].data.map((event) => event.eventType)).toEqual([
      'table.session.updated',
      'bill.updated',
    ]);
    expect(tx.idempotencyRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          responseBody: result,
          operation: 'REQUEST_CHECKOUT',
        }) as unknown,
      }),
    );
  });

  it('rejects stale Bill version before persistence', async () => {
    const { service, tx, principal, input } = setup();
    await expect(
      service.checkoutStaff(principal, { ...input, expectedBillVersion: 2 }),
    ).rejects.toMatchObject({ response: { code: 'CHECKOUT_VERSION_CONFLICT' } });
    expect(tx.tableSession.update).not.toHaveBeenCalled();
  });

  it('does not replay an operation after transaction-time authorization is revoked', async () => {
    const { service, tx, principal, input } = setup();
    tx.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([{ id: input.tableSessionId }])
      .mockResolvedValueOnce([{ id: randomUUID() }])
      .mockResolvedValueOnce([]);
    await expect(service.checkoutStaff(principal, input)).rejects.toMatchObject({
      response: { code: 'STAFF_SESSION_INVALID' },
    });
    expect(tx.idempotencyRecord.findUnique).not.toHaveBeenCalled();
  });

  it('bubbles a late persistence failure for the transaction to roll back', async () => {
    const { service, tx, principal, input } = setup();
    tx.idempotencyRecord.create.mockRejectedValueOnce(new Error('late failure'));
    await expect(service.checkoutStaff(principal, input)).rejects.toThrow('late failure');
  });
});
