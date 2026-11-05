import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service.js';
import type { OutboxEvent } from '../generated/prisma/client.js';

export type ClaimedEvent = OutboxEvent & { claimToken: string; leaseUntil: Date };

@Injectable()
export class OutboxStore {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async claim(
    limit: number,
    leaseSeconds: number,
    maxAttempts: number,
    restaurantId: string | null = null,
  ): Promise<ClaimedEvent[]> {
    const token = randomUUID();
    // Single statement: row locks last only for the claim, never across transport IO.
    const ids = await this.prisma.$queryRaw<Array<{ id: string }>>`
      WITH candidates AS (
        SELECT id FROM outbox_event
        WHERE published_at IS NULL AND failed_at IS NULL
          AND (next_attempt_at IS NULL OR next_attempt_at <= now())
          AND (lease_until IS NULL OR lease_until <= now())
          AND (${restaurantId}::uuid IS NULL OR restaurant_id = ${restaurantId}::uuid)
        ORDER BY occurred_at, id LIMIT ${limit} FOR UPDATE SKIP LOCKED
      ) UPDATE outbox_event e SET
          claim_token = CASE WHEN attempt_count >= ${maxAttempts} THEN NULL ELSE ${token}::uuid END,
          lease_until = CASE WHEN attempt_count >= ${maxAttempts} THEN NULL ELSE now() + make_interval(secs => ${leaseSeconds}::int) END,
          failed_at = CASE WHEN attempt_count >= ${maxAttempts} THEN now() ELSE NULL END,
          last_error = CASE WHEN attempt_count >= ${maxAttempts} THEN 'OUTBOX_ATTEMPTS_EXHAUSTED' ELSE last_error END,
          attempt_count = CASE WHEN attempt_count >= ${maxAttempts} THEN attempt_count ELSE attempt_count + 1 END
      FROM candidates c WHERE e.id = c.id RETURNING e.id`;
    if (ids.length === 0) return [];
    return this.prisma.outboxEvent.findMany({
      where: {
        id: { in: ids.map(({ id }) => id) },
        claimToken: token,
        failedAt: null,
      },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    }) as Promise<ClaimedEvent[]>;
  }

  async owns(event: ClaimedEvent): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM outbox_event WHERE id = ${event.id}::uuid AND claim_token = ${event.claimToken}::uuid
        AND lease_until > now() AND published_at IS NULL AND failed_at IS NULL`;
    return rows.length === 1;
  }

  async complete(event: ClaimedEvent): Promise<boolean> {
    return (
      (await this.prisma.$executeRaw`
      -- Event time may come from an application clock ahead of PostgreSQL.
      UPDATE outbox_event SET published_at = GREATEST(clock_timestamp(), occurred_at), claim_token = NULL, lease_until = NULL, last_error = NULL
      WHERE id = ${event.id}::uuid AND claim_token = ${event.claimToken}::uuid
        AND lease_until > now() AND published_at IS NULL AND failed_at IS NULL`) === 1
    );
  }

  async fail(event: ClaimedEvent, maxAttempts: number, permanent = false): Promise<void> {
    const terminal = permanent || event.attemptCount >= maxAttempts;
    const delaySeconds = Math.min(300, 2 ** Math.min(event.attemptCount, 9));
    await this.prisma.$executeRaw`
      UPDATE outbox_event SET claim_token = NULL, lease_until = NULL,
        last_error = ${permanent ? 'OUTBOX_EVENT_INVALID' : 'OUTBOX_DELIVERY_FAILED'},
        failed_at = CASE WHEN ${terminal} THEN now() ELSE NULL END,
        next_attempt_at = GREATEST(clock_timestamp(), occurred_at) + make_interval(secs => ${delaySeconds}::int)
      WHERE id = ${event.id}::uuid AND claim_token = ${event.claimToken}::uuid
        AND lease_until > now() AND published_at IS NULL`;
  }
}
