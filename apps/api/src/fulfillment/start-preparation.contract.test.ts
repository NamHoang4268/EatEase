import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { FulfillmentController } from './fulfillment.controller.js';
import type { FulfillmentService } from './fulfillment.service.js';
import type { StartPreparationService } from './start-preparation.service.js';
import { parseStartPreparation } from './start-preparation.contract.js';
import type { StaffRequest } from '../staff-auth/staff-auth.types.js';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../database/prisma.service.js';
import { FulfillmentModule } from './fulfillment.module.js';

const id = '31000000-0000-4000-8000-000000000001';
describe('start preparation contract', () => {
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
    expect(() => parseStartPreparation(id, body, 'key')).toThrow(BadRequestException);
  });
  it.each([undefined, '', '   ', 'x'.repeat(129), ['duplicate', 'header']])(
    'rejects invalid key %j',
    (key) => {
      expect(() => parseStartPreparation(id, { expectedVersion: 0 }, key)).toThrow(
        BadRequestException,
      );
    },
  );
  it('rejects malformed resource IDs', () => {
    expect(() => parseStartPreparation('invalid', { expectedVersion: 0 }, 'key')).toThrow(
      BadRequestException,
    );
  });
  it('forwards only normalized input and the authenticated principal in the existing data envelope', async () => {
    const result = {
      item: { id, status: 'PREPARING', version: 1, preparingAt: '2026-11-06T00:00:00.000Z' },
    };
    const start = vi.fn().mockResolvedValue(result);
    const controller = new FulfillmentController(
      {} as FulfillmentService,
      { start } as unknown as StartPreparationService,
    );
    const principal = { membershipId: id };
    expect(
      await controller.startPreparation(id, { expectedVersion: 0 }, ' key ', {
        staffPrincipal: principal,
      } as StaffRequest),
    ).toEqual({ data: result });
    expect(start).toHaveBeenCalledWith(principal, {
      itemId: id,
      expectedVersion: 0,
      idempotencyKey: 'key',
    });
  });
});
