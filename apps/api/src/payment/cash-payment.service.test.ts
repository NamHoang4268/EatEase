import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { StaffPrincipal } from '../staff-auth/staff-auth.types.js';
import { CashPaymentService } from './cash-payment.service.js';

function setup(amount = 48_000n) {
  const session = {
    id: randomUUID(),
    tableId: randomUUID(),
    status: 'CHECKOUT_LOCKED',
    version: 2,
    activatedAt: new Date(Date.now() - 60_000),
    checkoutLockedAt: new Date(Date.now() - 30_000),
  };
  const bill = {
    id: randomUUID(),
    status: 'PAYMENT_PENDING',
    version: 3,
    subtotalAmount: amount,
    adjustmentAmount: 0n,
    totalAmount: amount,
    paidAmount: 0n,
    balanceAmount: amount,
  };
  const principal = {
    sessionId: randomUUID(),
    staffUserId: randomUUID(),
    membershipId: randomUUID(),
    restaurantId: randomUUID(),
    locationId: randomUUID(),
  } as StaffPrincipal;
  const expiresAt = new Date(Date.now() + 600_000);
  const tx = {
    $queryRaw: vi
      .fn()
      .mockResolvedValueOnce([session])
      .mockResolvedValueOnce([{ id: bill.id }])
      .mockResolvedValueOnce([{ expiresAt }])
      .mockResolvedValueOnce([{ id: randomUUID() }]),
    bill: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(bill),
      update: vi
        .fn()
        .mockResolvedValue({ ...bill, version: 4, paidAmount: amount, balanceAmount: 0n }),
    },
    restaurantTable: { findUnique: vi.fn().mockResolvedValue({ physicalStatus: 'OCCUPIED' }) },
    payment: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: randomUUID(), amount, recordedAt: new Date() }),
    },
    settlement: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi
        .fn()
        .mockResolvedValue({ id: randomUUID(), settledAmount: amount, settledAt: new Date() }),
    },
    auditLog: { create: vi.fn() },
    outboxEvent: { create: vi.fn() },
    idempotencyRecord: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
  };
  const prisma = {
    $transaction: vi
      .fn()
      .mockImplementation((callback: (client: typeof tx) => unknown) => callback(tx)),
    idempotencyRecord: { findUnique: vi.fn().mockResolvedValue({ id: randomUUID() }) },
  };
  return {
    service: new CashPaymentService(prisma as unknown as PrismaService),
    tx,
    prisma,
    session,
    bill,
    principal,
    input: {
      tableSessionId: session.id,
      expectedSessionVersion: 2,
      expectedBillVersion: 3,
      idempotencyKey: randomUUID(),
    },
  };
}

describe('M4.3 atomic cash command', () => {
  it('preserves BIGINT precision and persists audit/outbox/idempotency with the exact server balance', async () => {
    const amount = 9_007_199_254_740_993n;
    const { service, tx, principal, input } = setup(amount);
    const result = await service.record(principal, input);
    expect(result.bill).toMatchObject({
      status: 'SETTLED',
      version: 4,
      totalAmount: amount.toString(),
      paidAmount: amount.toString(),
      balanceAmount: '0',
    });
    expect(result.session).toEqual({
      id: input.tableSessionId,
      status: 'CHECKOUT_LOCKED',
      version: 2,
    });
    expect(tx.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amount,
        method: 'CASH',
        status: 'SUCCEEDED',
        recordedByMembershipId: principal.membershipId,
      }) as unknown,
    });
    expect(tx.bill.update).toHaveBeenCalledWith({
      where: { id: result.bill.id },
      data: { status: 'SETTLED', paidAmount: amount, balanceAmount: 0n, version: { increment: 1 } },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'CASH_PAYMENT_SETTLED',
        actorId: principal.membershipId,
      }) as unknown,
    });
    expect(tx.outboxEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: 'bill.updated',
        payload: expect.objectContaining({
          tableSessionId: input.tableSessionId,
          version: 4,
        }) as unknown,
      }) as unknown,
    });
    expect(tx.idempotencyRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        operation: 'RECORD_CASH_PAYMENT',
        responseBody: result,
      }) as unknown,
    });
  });

  it('settles zero balance without creating a fake Payment', async () => {
    const { service, tx, principal, input } = setup(0n);
    const result = await service.record(principal, input);
    expect(result.payment).toBeNull();
    expect(result.settlement.settledAmount).toBe('0');
    expect(tx.payment.create).not.toHaveBeenCalled();
  });

  it.each(['session', 'bill'] as const)(
    'rejects stale %s versions before writes',
    async (target) => {
      const { service, tx, principal, input } = setup();
      const versions =
        target === 'session' ? { expectedSessionVersion: 1 } : { expectedBillVersion: 2 };
      await expect(service.record(principal, { ...input, ...versions })).rejects.toMatchObject({
        response: { code: 'CASH_PAYMENT_VERSION_CONFLICT' },
      });
      expect(tx.payment.create).not.toHaveBeenCalled();
      expect(tx.settlement.create).not.toHaveBeenCalled();
    },
  );

  it.each(['session', 'bill', 'table', 'payment', 'settlement', 'partial', 'arithmetic'] as const)(
    'fails closed for inconsistent %s state',
    async (kind) => {
      const { service, tx, session, bill, principal, input } = setup();
      if (kind === 'session') session.status = 'ACTIVE';
      if (kind === 'bill') bill.status = 'SETTLED';
      if (kind === 'table')
        tx.restaurantTable.findUnique.mockResolvedValue({ physicalStatus: 'CLEANING' });
      if (kind === 'payment') tx.payment.findFirst.mockResolvedValue({ id: randomUUID() });
      if (kind === 'settlement') tx.settlement.findUnique.mockResolvedValue({ id: randomUUID() });
      if (kind === 'partial') {
        bill.paidAmount = 1n;
        bill.balanceAmount -= 1n;
      }
      if (kind === 'arithmetic') bill.balanceAmount = 1n;
      await expect(service.record(principal, input)).rejects.toMatchObject({
        response: { code: 'CASH_PAYMENT_STATE_CONFLICT' },
      });
      expect(tx.payment.create).not.toHaveBeenCalled();
      expect(tx.settlement.create).not.toHaveBeenCalled();
    },
  );

  it('replays only after current authorization, even with historical versions', async () => {
    const { service, tx, principal, input } = setup();
    const first = await service.record(principal, input);
    const stored = tx.idempotencyRecord.create.mock.calls[0]![0] as {
      data: { requestHash: string };
    };
    const retry = setup();
    retry.session.id = input.tableSessionId;
    retry.tx.idempotencyRecord.findUnique.mockResolvedValue({
      restaurantId: principal.restaurantId,
      resourceId: input.tableSessionId,
      requestHash: stored.data.requestHash,
      responseBody: first,
    });
    expect(await retry.service.record(principal, input)).toEqual(first);
    expect(retry.tx.bill.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(retry.tx.payment.create).not.toHaveBeenCalled();
    expect(retry.tx.idempotencyRecord.create).not.toHaveBeenCalled();
  });

  it('rejects a reused key with different payload', async () => {
    const { service, tx, principal, input } = setup();
    tx.idempotencyRecord.findUnique.mockResolvedValue({
      restaurantId: principal.restaurantId,
      resourceId: input.tableSessionId,
      requestHash: 'different',
    });
    await expect(service.record(principal, input)).rejects.toMatchObject({
      response: { code: 'IDEMPOTENCY_KEY_REUSED' },
    });
  });

  it.each(['session', 'permission'] as const)(
    'revalidates current %s before replay',
    async (kind) => {
      const { service, tx, principal, input } = setup();
      tx.$queryRaw
        .mockReset()
        .mockResolvedValueOnce([{ id: input.tableSessionId }])
        .mockResolvedValueOnce([{ id: randomUUID() }]);
      if (kind === 'session') tx.$queryRaw.mockResolvedValueOnce([]);
      else
        tx.$queryRaw
          .mockResolvedValueOnce([{ expiresAt: new Date(Date.now() + 60_000) }])
          .mockResolvedValueOnce([]);
      await expect(service.record(principal, input)).rejects.toMatchObject({
        status: kind === 'session' ? 401 : 403,
      });
      expect(tx.idempotencyRecord.findUnique).not.toHaveBeenCalled();
    },
  );

  it.each(['auditLog', 'outboxEvent', 'idempotencyRecord'] as const)(
    'propagates a %s failure so the transaction rolls back',
    async (delegate) => {
      const { service, tx, principal, input } = setup();
      tx[delegate].create.mockRejectedValueOnce(new Error('M43 late failure'));
      await expect(service.record(principal, input)).rejects.toThrow('M43 late failure');
    },
  );

  it('re-enters authorization and locks after an actor/key uniqueness race', async () => {
    const { service, prisma, principal, input } = setup();
    prisma.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('duplicate key', {
        code: 'P2002',
        clientVersion: '7.10.1',
      }),
    );
    await service.record(principal, input);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(prisma.idempotencyRecord.findUnique).toHaveBeenCalledOnce();
  });
});
