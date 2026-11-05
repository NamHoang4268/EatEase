import { describe, expect, it } from 'vitest';
import { matches, notification, ticketBody, type Subscription } from './realtime.contract.js';

const id = '31000000-0000-4000-8000-000000000001';
const scope: Subscription = {
  actorType: 'STAFF',
  actorSessionId: id,
  restaurantId: 'r',
  locationId: 'l',
  audience: 'kitchen',
  resourceId: null,
  origin: 'http://localhost:3000',
};
describe('realtime contracts', () => {
  it('rejects caller-selected scope and malformed audiences', () => {
    expect(() => ticketBody({ audience: 'kitchen', restaurantId: id })).toThrow();
    expect(() => ticketBody({ audience: 'admin' })).toThrow();
    expect(() => ticketBody({ audience: 'bill', tableSessionId: 'invalid' })).toThrow();
  });
  it('whitelists minimal notification data and rejects malformed/unknown events', () => {
    expect(
      notification({
        id,
        eventType: 'bill.updated',
        payload: { id, version: 2, tableSessionId: id, amount: 'secret', token: 'secret' },
      }).data,
    ).toEqual({ eventId: id, type: 'bill.updated', resourceId: id, version: 2 });
    expect(() => notification({ id, eventType: 'unknown', payload: {} })).toThrow();
    expect(() =>
      notification({ id, eventType: 'bill.updated', payload: { id, version: 0 } }),
    ).toThrow();
  });
  it('isolates kitchen audiences by tenant, location and event type', () => {
    const event = { restaurantId: 'r', locationId: 'l', eventType: 'fulfillment.item.created' };
    expect(matches(scope, event, {})).toBe(true);
    expect(matches(scope, { ...event, restaurantId: 'foreign' }, {})).toBe(false);
    expect(matches(scope, { ...event, locationId: 'foreign' }, {})).toBe(false);
    expect(matches(scope, { ...event, eventType: 'bill.updated' }, {})).toBe(false);
  });
  it('isolates guest table and bill audiences without granting staff room access', () => {
    const event = { restaurantId: 'r', locationId: 'l', eventType: 'activation.updated' };
    const guest = {
      ...scope,
      actorType: 'GUEST' as const,
      audience: 'activation' as const,
      resourceId: id,
    };
    expect(matches(guest, event, { tableId: id })).toBe(true);
    expect(matches(guest, event, { tableId: 'foreign' })).toBe(false);
    const bill = { ...guest, audience: 'bill' as const };
    expect(matches(bill, { ...event, eventType: 'bill.updated' }, { tableSessionId: id })).toBe(
      true,
    );
    expect(
      matches(bill, { ...event, eventType: 'bill.updated' }, { tableSessionId: 'foreign' }),
    ).toBe(false);
  });
});
