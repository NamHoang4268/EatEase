import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RealtimeService } from './realtime.service.js';
import type { RealtimeTicketService } from './realtime-ticket.service.js';
import type { Subscription } from './realtime.contract.js';
import type { ClaimedEvent } from './outbox.store.js';

const id = '31000000-0000-4000-8000-000000000001';
const origin = 'http://localhost:3000';
const scope: Subscription = {
  actorType: 'STAFF',
  actorSessionId: id,
  restaurantId: id,
  locationId: id,
  audience: 'kitchen',
  resourceId: null,
  origin,
};
const event: ClaimedEvent = {
  id,
  restaurantId: id,
  locationId: id,
  aggregateId: id,
  aggregateType: 'OrderItem',
  eventType: 'fulfillment.item.created',
  payload: { id, tableSessionId: id, version: 0 },
  occurredAt: new Date(),
  publishedAt: null,
  attemptCount: 1,
  nextAttemptAt: null,
  claimToken: id,
  leaseUntil: new Date(Date.now() + 60_000),
  failedAt: null,
  lastError: null,
};

describe('Socket.IO transport with mocked authorization (no database)', () => {
  let http: Server, service: RealtimeService, endpoint: string;
  const sockets: Socket[] = [];
  const tickets = { consume: vi.fn(), authorize: vi.fn(), cleanup: vi.fn() };
  beforeEach(async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATABASE_URL', 'postgresql://local:local@localhost/eatease_m2_test');
    vi.stubEnv('REALTIME_ENABLED', 'true');
    vi.stubEnv('REALTIME_PUBLIC_URL', 'http://localhost:3001');
    vi.stubEnv('TRUSTED_WEB_ORIGINS', origin);
    tickets.consume.mockReset().mockResolvedValue(scope);
    tickets.authorize.mockReset().mockResolvedValue(true);
    tickets.cleanup.mockReset().mockResolvedValue(undefined);
    http = createServer();
    service = new RealtimeService(tickets as unknown as RealtimeTicketService);
    service.attach(http);
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    endpoint = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    sockets.splice(0).forEach((socket) => socket.disconnect());
    await service.onModuleDestroy();
    vi.unstubAllEnvs();
  });
  function connect(
    token = 'test-ticket',
    suppliedOrigin = origin,
    query: Record<string, string> = {},
  ): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const client = io(endpoint, {
        transports: ['websocket'],
        reconnection: false,
        forceNew: true,
        timeout: 1000,
        auth: { ticket: token },
        query,
        extraHeaders: { Origin: suppliedOrigin },
      });
      sockets.push(client);
      client.once('connect', () => resolve(client));
      client.once('connect_error', reject);
    });
  }
  function once<T>(socket: Socket, name: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Expected ${name}`)), 1500);
      socket.once(name, (value: T) => {
        clearTimeout(timer);
        resolve(value);
      });
    });
  }
  it('fails closed for invalid tickets, untrusted Origin and query-string proof', async () => {
    tickets.consume.mockResolvedValueOnce(null);
    await expect(connect()).rejects.toThrow('REALTIME_UNAUTHORIZED');
    await expect(connect('test-ticket', 'https://attacker.invalid')).rejects.toThrow();
    await expect(connect('test-ticket', origin, { ticket: 'must-not-be-in-url' })).rejects.toThrow(
      'REALTIME_UNAUTHORIZED',
    );
  });
  it('emits minimal matching hints and tolerates duplicate delivery', async () => {
    const client = await connect();
    const first = once<unknown>(client, 'invalidate');
    await service.emit(event);
    const expected = { eventId: id, type: 'fulfillment.item.created', resourceId: id, version: 0 };
    expect(await first).toEqual(expected);
    const duplicate = once<unknown>(client, 'invalidate');
    await service.emit(event);
    expect(await duplicate).toEqual(expected);
  });
  it('redacts private activation IDs in Guest hints', async () => {
    tickets.consume.mockResolvedValueOnce({
      ...scope,
      actorType: 'GUEST',
      audience: 'activation',
      resourceId: id,
    });
    const client = await connect();
    const hint = once<unknown>(client, 'invalidate');
    await service.emit({
      ...event,
      eventType: 'activation.updated',
      payload: { id, tableId: id, version: 1 },
    });
    expect(await hint).toEqual({
      eventId: id,
      type: 'activation.updated',
      resourceId: 'current-table',
      version: 1,
    });
  });
  it('disconnects revoked permissions before any matching emission', async () => {
    const client = await connect();
    const disconnected = once(client, 'disconnect');
    tickets.authorize.mockResolvedValueOnce(false);
    await service.emit(event);
    await disconnected;
    expect(client.connected).toBe(false);
  });
  it('treats authorization database failure as transport failure, never success', async () => {
    const client = await connect();
    const disconnected = once(client, 'disconnect');
    tickets.authorize.mockRejectedValueOnce(new Error('DB unavailable'));
    await expect(service.emit(event)).rejects.toThrow('REALTIME_AUTHORIZATION_UNAVAILABLE');
    await disconnected;
  });
  it('checks idle revocation and refuses caller-selected subscription commands', async () => {
    const first = await connect();
    const revoked = once(first, 'disconnect');
    tickets.authorize.mockResolvedValueOnce(false);
    await service.revalidate();
    await revoked;
    const second = await connect();
    const rejected = once(second, 'disconnect');
    second.emit('join-room', 'foreign');
    await rejected;
    expect(tickets.cleanup).toHaveBeenCalledOnce();
  });
});
