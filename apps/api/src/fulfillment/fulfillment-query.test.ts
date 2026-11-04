import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { encodeQueueCursor, parseFulfillmentQuery } from './fulfillment-query.js';

describe('fulfillment query contract', () => {
  it('defaults to NEW, all stations and a bounded page', () => {
    expect(parseFulfillmentQuery({})).toEqual({ status: 'NEW', limit: 50 });
    expect(parseFulfillmentQuery({ station: 'BAR', limit: '100' })).toEqual({
      status: 'NEW',
      station: 'BAR',
      limit: 100,
    });
  });

  it('round trips a timestamp/item keyset cursor', () => {
    const cursor = {
      submittedAt: '2026-11-05T00:00:00.000Z',
      itemId: 'a1000000-0000-4000-8000-000000000001',
    };
    expect(parseFulfillmentQuery({ cursor: encodeQueueCursor(cursor) }).cursor).toEqual(cursor);
  });

  it.each([
    { limit: '0' },
    { limit: '101' },
    { limit: '-1' },
    { limit: '2.5' },
    { limit: ['1', '2'] },
    { status: 'PREPARING' },
    { station: 'OTHER' },
    { locationId: 'client-scope' },
    { cursor: 'invalid' },
    {
      cursor: Buffer.from(JSON.stringify({ submittedAt: 'bad', itemId: 'bad' })).toString(
        'base64url',
      ),
    },
  ])('rejects invalid filters, scope and cursors: %j', (query) => {
    expect(() => parseFulfillmentQuery(query)).toThrow(BadRequestException);
  });
});
