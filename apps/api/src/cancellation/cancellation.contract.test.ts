import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import { DatabaseModule } from '../database/database.module.js';
import { PrismaService } from '../database/prisma.service.js';
import type { GuestRequest } from '../guest-session/guest-session.types.js';
import { REQUIRED_PERMISSIONS } from '../staff-auth/auth.constants.js';
import type { StaffRequest } from '../staff-auth/staff-auth.types.js';
import {
  parseCancellationDecision,
  parseCancellationForward,
  parseDirectRejection,
  parseGuestCancellation,
} from './cancellation.contract.js';
import { CancellationController } from './cancellation.controller.js';
import { CancellationModule } from './cancellation.module.js';
import type { CancellationService } from './cancellation.service.js';

const id = '31000000-0000-4000-8000-000000000001';

describe('M3.5 cancellation transport contract', () => {
  it('initializes guards and providers without a database connection', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://local:local@127.0.0.1:5432/eatease_m2_test');
    vi.stubEnv('NODE_ENV', 'test');
    try {
      const module = await Test.createTestingModule({
        imports: [DatabaseModule, CancellationModule],
      })
        .overrideProvider(PrismaService)
        .useValue({})
        .compile();
      try {
        expect(module.get(CancellationController)).toBeInstanceOf(CancellationController);
      } finally {
        await module.close();
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it.each([
    undefined,
    {},
    { expectedVersion: -1, reason: 'x' },
    { expectedVersion: 0.5, reason: 'x' },
    { expectedVersion: 0, reason: '' },
    { expectedVersion: 0, reason: 'x'.repeat(501) },
    { expectedVersion: 0, reason: 'x', restaurantId: id },
  ])('rejects invalid guest input %j', (body) => {
    expect(() => parseGuestCancellation(id, body, 'key')).toThrow(BadRequestException);
  });

  it.each([undefined, '', ' ', 'x'.repeat(129), ['one', 'two']])(
    'rejects invalid idempotency key %j',
    (key) => {
      expect(() =>
        parseGuestCancellation(id, { expectedVersion: 0, reason: 'Đổi món' }, key),
      ).toThrow(BadRequestException);
    },
  );

  it('normalizes each command without accepting caller scope', () => {
    expect(
      parseGuestCancellation(id, { expectedVersion: 2, reason: ' Đổi món ' }, ' key '),
    ).toEqual({ itemId: id, expectedVersion: 2, reason: 'Đổi món', idempotencyKey: 'key' });
    expect(
      parseCancellationDecision(
        id,
        { expectedVersion: 1, decision: 'ACCEPT', reason: ' Dừng được ' },
        ' key ',
      ),
    ).toEqual({
      requestId: id,
      expectedVersion: 1,
      decision: 'ACCEPT',
      reason: 'Dừng được',
      idempotencyKey: 'key',
    });
    expect(
      parseCancellationForward(id, { expectedVersion: 0, reason: ' Chuyển bếp ' }, 'k'),
    ).toEqual({ requestId: id, expectedVersion: 0, reason: 'Chuyển bếp', idempotencyKey: 'k' });
    expect(parseDirectRejection(id, { expectedVersion: 3, reason: ' Hết món ' }, 'k')).toEqual({
      itemId: id,
      expectedVersion: 3,
      reason: 'Hết món',
      idempotencyKey: 'k',
    });
  });

  it.each([
    ['decideWaiter', ['order.cancel_new']],
    ['forward', ['cancellation.forward_to_kitchen']],
    ['decideOperational', ['cancellation.decide_operational']],
    ['rejectItem', ['cancellation.decide_operational']],
  ] as const)('requires the dedicated permission on %s', (method, permissions) => {
    const handler: unknown = Object.getOwnPropertyDescriptor(
      CancellationController.prototype,
      method,
    )?.value;
    if (typeof handler !== 'function') throw new Error(`Missing ${method}`);
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS, handler)).toEqual(permissions);
  });

  it('forwards authenticated Guest and Staff principals with normalized inputs', async () => {
    const result = {
      cancellationRequest: { id, orderItemId: id, status: 'PENDING_WAITER', version: 0 },
    };
    const requestGuest = vi.fn().mockResolvedValue(result);
    const decideWaiter = vi.fn().mockResolvedValue(result);
    const controller = new CancellationController({
      requestGuest,
      decideWaiter,
    } as unknown as CancellationService);
    const guestPrincipal = { sessionId: id };
    const staffPrincipal = { membershipId: id };
    expect(
      await controller.request(id, { expectedVersion: 0, reason: ' Đổi món ' }, ' key ', {
        guestPrincipal,
      } as GuestRequest),
    ).toEqual({ data: result });
    expect(requestGuest).toHaveBeenCalledWith(guestPrincipal, {
      itemId: id,
      expectedVersion: 0,
      reason: 'Đổi món',
      idempotencyKey: 'key',
    });
    expect(
      await controller.decideWaiter(
        id,
        { expectedVersion: 0, decision: 'REJECT', reason: ' Tiếp tục món ' },
        ' key ',
        { staffPrincipal } as StaffRequest,
      ),
    ).toEqual({ data: result });
    expect(decideWaiter).toHaveBeenCalledWith(staffPrincipal, {
      requestId: id,
      expectedVersion: 0,
      decision: 'REJECT',
      reason: 'Tiếp tục món',
      idempotencyKey: 'key',
    });
  });
});
