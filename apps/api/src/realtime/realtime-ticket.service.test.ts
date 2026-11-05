import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RealtimeTicketService } from './realtime-ticket.service.js';
import type { PrismaService } from '../database/prisma.service.js';
import type { StaffSessionService } from '../staff-auth/staff-session.service.js';
import type { GuestSessionService } from '../guest-session/guest-session.service.js';
import type { Subscription } from './realtime.contract.js';

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
beforeEach(() => {
  vi.stubEnv('DATABASE_URL', 'postgresql://local:local@localhost/eatease_m2_test');
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('REALTIME_ENABLED', 'true');
  vi.stubEnv('REALTIME_PUBLIC_URL', 'http://localhost:3001');
});
afterEach(() => vi.unstubAllEnvs());
function fixture() {
  const staff = {
    authenticateSessionId: vi.fn().mockResolvedValue({
      restaurantId: 'r',
      locationId: 'l',
      permissions: ['fulfillment.read', 'bill.read'],
    }),
  };
  const guest = {
    authenticateSessionId: vi.fn().mockResolvedValue({
      restaurantId: 'r',
      locationId: 'l',
      tableId: id,
      accessLevel: 'BROWSE_ONLY',
      tableSessionId: null,
    }),
  };
  const prisma = { tableSession: { count: vi.fn().mockResolvedValue(1) } };
  return {
    staff,
    guest,
    prisma,
    service: new RealtimeTicketService(
      prisma as unknown as PrismaService,
      staff as unknown as StaffSessionService,
      guest as unknown as GuestSessionService,
    ),
  };
}
describe('realtime authorization', () => {
  it('rechecks current staff permissions, active session and location on each delivery', async () => {
    const { staff, service } = fixture();
    expect(await service.authorize(scope)).toBe(true);
    staff.authenticateSessionId.mockResolvedValueOnce(null);
    expect(await service.authorize(scope)).toBe(false);
    staff.authenticateSessionId.mockResolvedValueOnce({
      restaurantId: 'r',
      locationId: 'foreign',
      permissions: ['fulfillment.read'],
    });
    expect(await service.authorize(scope)).toBe(false);
    staff.authenticateSessionId.mockResolvedValueOnce({
      restaurantId: 'r',
      locationId: 'l',
      permissions: [],
    });
    expect(await service.authorize(scope)).toBe(false);
  });
  it('restricts guest activation to their own table and bill to an order-enabled bound session', async () => {
    const { service, guest } = fixture();
    const activation: Subscription = {
      ...scope,
      actorType: 'GUEST',
      audience: 'activation',
      resourceId: id,
    };
    expect(await service.authorize(activation)).toBe(true);
    expect(await service.authorize({ ...activation, resourceId: 'foreign' })).toBe(false);
    expect(await service.authorize({ ...activation, audience: 'kitchen' })).toBe(false);
    expect(await service.authorize({ ...activation, audience: 'bill' })).toBe(false);
    guest.authenticateSessionId.mockResolvedValueOnce({
      restaurantId: 'r',
      locationId: 'l',
      tableId: id,
      accessLevel: 'ORDER_ENABLED',
      tableSessionId: id,
    });
    expect(await service.authorize({ ...activation, audience: 'bill' })).toBe(true);
  });
  it('rejects closed sessions and untrusted origins', async () => {
    const { service, prisma } = fixture();
    prisma.tableSession.count.mockResolvedValue(0);
    expect(await service.authorize({ ...scope, audience: 'bill', resourceId: id })).toBe(false);
    expect(await service.authorize({ ...scope, origin: 'https://attacker.invalid' })).toBe(false);
  });
  it('fails malformed or untrusted ticket proof before any database call', async () => {
    const { service } = fixture();
    expect(await service.consume('invalid', scope.origin)).toBeNull();
    expect(await service.consume('a'.repeat(43), undefined)).toBeNull();
    expect(await service.consume('a'.repeat(43), 'https://attacker.invalid')).toBeNull();
  });
});
