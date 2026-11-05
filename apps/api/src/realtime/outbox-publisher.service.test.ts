import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { OutboxPublisher } from './outbox-publisher.service.js';
import type { OutboxStore, ClaimedEvent } from './outbox.store.js';
import type { RealtimeService } from './realtime.service.js';

const id = '31000000-0000-4000-8000-000000000001';
const event: ClaimedEvent = {
  id,
  claimToken: id,
  leaseUntil: new Date(Date.now() + 60_000),
  restaurantId: id,
  locationId: id,
  occurredAt: new Date(),
  aggregateType: 'Bill',
  aggregateId: id,
  publishedAt: null,
  failedAt: null,
  lastError: null,
  nextAttemptAt: null,
  eventType: 'bill.updated',
  payload: { id, tableSessionId: id, version: 1 },
  attemptCount: 1,
};
beforeEach(() => {
  vi.stubEnv('DATABASE_URL', 'postgresql://local:local@localhost/eatease_m2_test');
  vi.stubEnv('NODE_ENV', 'test');
  vi.useFakeTimers();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
function fixture() {
  const store = {
    claim: vi.fn().mockResolvedValue([event]),
    owns: vi.fn().mockResolvedValue(true),
    complete: vi.fn().mockResolvedValue(true),
    fail: vi.fn().mockResolvedValue(undefined),
  };
  const transport = { emit: vi.fn().mockResolvedValue(undefined) };
  return {
    store,
    transport,
    worker: new OutboxPublisher(
      store as unknown as OutboxStore,
      transport as unknown as RealtimeService,
    ),
  };
}
describe('outbox publisher', () => {
  it('logs only a safe failure code, not sensitive transport error contents', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { transport, worker } = fixture();
    const sensitive = 'synthetic-session-token-and-join-code-sentinel';
    transport.emit.mockRejectedValueOnce(new Error(sensitive));
    await worker.runOnce();
    expect(warn).toHaveBeenCalledWith('OUTBOX_DELIVERY_FAILED');
    expect(JSON.stringify(warn.mock.calls)).not.toContain(sensitive);
  });
  it('marks emission successful only after transport resolves', async () => {
    const { store, transport, worker } = fixture();
    let resolve!: () => void;
    transport.emit.mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const processing = worker.runOnce();
    await vi.waitFor(() => expect(transport.emit).toHaveBeenCalledOnce());
    expect(store.complete).not.toHaveBeenCalled();
    resolve();
    await processing;
    expect(store.complete).toHaveBeenCalledWith(event);
  });
  it('retains failed transport deliveries for bounded retries and permits duplicate notifications', async () => {
    const { store, transport, worker } = fixture();
    transport.emit.mockRejectedValueOnce(new Error('transport failed'));
    await worker.runOnce();
    expect(store.fail).toHaveBeenCalledWith(event, 8);
    expect(store.complete).not.toHaveBeenCalled();
    await worker.runOnce();
    await worker.runOnce();
    expect(transport.emit).toHaveBeenCalledTimes(3);
    expect(store.complete).toHaveBeenCalledTimes(2);
  });
  it('never emits a lost claim and quarantines poison events', async () => {
    const { store, transport, worker } = fixture();
    store.owns.mockResolvedValueOnce(false);
    await worker.runOnce();
    expect(transport.emit).not.toHaveBeenCalled();
    store.claim.mockResolvedValueOnce([{ ...event, eventType: 'unknown' }]);
    await worker.runOnce();
    expect(store.fail).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'unknown' }),
      8,
      true,
    );
    expect(transport.emit).not.toHaveBeenCalled();
  });
  it('does not start timers in tests, including when explicitly enabled', async () => {
    vi.stubEnv('REALTIME_ENABLED', 'true');
    vi.stubEnv('REALTIME_PUBLIC_URL', 'http://localhost:3001');
    vi.stubEnv('OUTBOX_PUBLISHER_ENABLED', 'true');
    const { worker, store } = fixture();
    worker.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(store.claim).not.toHaveBeenCalled();
    await worker.onModuleDestroy();
  });
});
