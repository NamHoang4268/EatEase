import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { loadEnvironment } from '../config/environment.js';
import { OutboxStore } from './outbox.store.js';
import { RealtimeService } from './realtime.service.js';
import { notification } from './realtime.contract.js';

@Injectable()
export class OutboxPublisher implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly env = loadEnvironment();
  private readonly logger = new Logger(OutboxPublisher.name);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private stopping = false;
  private lastSuccessAt: string | null = null;
  private lastError: string | null = null;

  constructor(
    @Inject(OutboxStore) private readonly store: OutboxStore,
    @Inject(RealtimeService) private readonly transport: RealtimeService,
  ) {}

  onApplicationBootstrap() {
    this.logger.log(
      this.env.OUTBOX_PUBLISHER_ENABLED && this.env.NODE_ENV !== 'test'
        ? 'OUTBOX_PUBLISHER_ENABLED'
        : 'OUTBOX_PUBLISHER_DISABLED',
    );
    // AppModule in tests never starts a worker, even if explicitly enabled for route tests.
    if (this.env.OUTBOX_PUBLISHER_ENABLED && this.env.NODE_ENV !== 'test') this.schedule(0);
  }

  private schedule(delay: number): void {
    if (this.stopping) return;
    this.timer = setTimeout(() => {
      this.running = this.runOnce()
        .catch(() => {
          this.lastError = 'OUTBOX_TICK_FAILED';
          this.logger.warn(this.lastError);
        })
        .finally(() => this.schedule(this.env.OUTBOX_POLL_MS));
    }, delay);
    this.timer.unref();
  }

  async runOnce(restaurantId: string | null = null): Promise<void> {
    const events = await this.store.claim(
      this.env.OUTBOX_BATCH_SIZE,
      this.env.OUTBOX_LEASE_SECONDS,
      this.env.OUTBOX_MAX_ATTEMPTS,
      restaurantId,
    );
    for (const event of events) {
      if (this.stopping || !(await this.store.owns(event))) continue;
      try {
        notification(event);
      } catch {
        await this.store.fail(event, this.env.OUTBOX_MAX_ATTEMPTS, true);
        continue;
      }
      try {
        await this.transport.emit(event);
        if (await this.store.complete(event)) {
          this.lastSuccessAt = new Date().toISOString();
          this.lastError = null;
        }
      } catch {
        this.lastError = 'OUTBOX_DELIVERY_FAILED';
        this.logger.warn(this.lastError);
        await this.store.fail(event, this.env.OUTBOX_MAX_ATTEMPTS);
      }
    }
  }

  status() {
    return {
      enabled: this.env.OUTBOX_PUBLISHER_ENABLED,
      lastSuccessAt: this.lastSuccessAt,
      lastError: this.lastError,
    };
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    await this.running;
  }
}
