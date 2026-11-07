import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { FulfillmentController } from './fulfillment.controller.js';
import type { FulfillmentService } from './fulfillment.service.js';
import type { FulfillmentTransitionService } from './fulfillment-transition.service.js';
import { parseFulfillmentTransition } from './fulfillment-transition.contract.js';
import type { StaffRequest } from '../staff-auth/staff-auth.types.js';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../database/prisma.service.js';
import { FulfillmentModule } from './fulfillment.module.js';
import { REQUIRED_PERMISSIONS } from '../staff-auth/auth.constants.js';

const id = '31000000-0000-4000-8000-000000000001';
describe('fulfillment transition contract', () => {
  it('initializes the actual module and mutation guards without a database connection', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://local:local@127.0.0.1:5432/eatease_m2_test');
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('REALTIME_ENABLED', 'false');
    vi.stubEnv('OUTBOX_PUBLISHER_ENABLED', 'false');
    try {
      const module = await Test.createTestingModule({ imports: [FulfillmentModule] })
        .overrideProvider(PrismaService)
        .useValue({})
        .compile();
      try {
        expect(module.get(FulfillmentController)).toBeInstanceOf(FulfillmentController);
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
    { expectedVersion: -1 },
    { expectedVersion: 0.5 },
    { expectedVersion: '0' },
    { expectedVersion: 2_147_483_647 },
    { expectedVersion: 0, locationId: id },
  ])('rejects invalid or caller-scoped body %j', (body) => {
    expect(() => parseFulfillmentTransition(id, body, 'key')).toThrow(BadRequestException);
  });
  it.each([undefined, '', '   ', 'x'.repeat(129), ['duplicate', 'header']])(
    'rejects invalid key %j',
    (key) => {
      expect(() => parseFulfillmentTransition(id, { expectedVersion: 0 }, key)).toThrow(
        BadRequestException,
      );
    },
  );
  it('rejects malformed resource IDs', () => {
    expect(() => parseFulfillmentTransition('invalid', { expectedVersion: 0 }, 'key')).toThrow(
      BadRequestException,
    );
  });
  it('requires the dedicated serving permission rather than preparation permission', () => {
    const handler: unknown = Object.getOwnPropertyDescriptor(
      FulfillmentController.prototype,
      'markServed',
    )?.value;
    if (typeof handler !== 'function') throw new Error('Serving handler is missing');
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS, handler)).toEqual(['serving.mark_served']);
  });
  it.each(['startPreparation', 'markReady', 'markServed'] as const)(
    'forwards normalized %s input and authenticated principal in the existing data envelope',
    async (method) => {
      const result = {
        item: {
          id,
          status:
            method === 'markServed' ? 'SERVED' : method === 'markReady' ? 'READY' : 'PREPARING',
          version: 1,
        },
      };
      const start = vi.fn().mockResolvedValue(result);
      const controller = new FulfillmentController(
        {} as FulfillmentService,
        { start, ready: start, served: start } as unknown as FulfillmentTransitionService,
      );
      const principal = { membershipId: id };
      expect(
        await controller[method](id, { expectedVersion: 0 }, ' key ', {
          staffPrincipal: principal,
        } as StaffRequest),
      ).toEqual({ data: result });
      expect(start).toHaveBeenCalledWith(principal, {
        itemId: id,
        expectedVersion: 0,
        idempotencyKey: 'key',
      });
    },
  );
});
