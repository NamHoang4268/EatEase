import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { loadEnvironment } from '../config/environment.js';
import { RealtimeTicketService } from './realtime-ticket.service.js';
import { matches, notification, type Subscription } from './realtime.contract.js';
import type { ClaimedEvent } from './outbox.store.js';

@Injectable()
export class RealtimeService implements OnModuleDestroy {
  private readonly env = loadEnvironment();
  private readonly logger = new Logger(RealtimeService.name);
  private io: Server | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private checking: Promise<void> | undefined;
  private stopping = false;
  private readonly clients = new Map<Socket, Subscription>();

  constructor(@Inject(RealtimeTicketService) private readonly tickets: RealtimeTicketService) {}

  attach(server: HttpServer): void {
    if (!this.env.REALTIME_ENABLED || this.io) return;
    this.io = new Server(server, {
      serveClient: false,
      transports: ['websocket'],
      maxHttpBufferSize: 2048,
      connectTimeout: 10_000,
      pingInterval: 25_000,
      pingTimeout: 20_000,
      allowRequest: (req, callback) =>
        callback(
          null,
          this.env.TRUSTED_WEB_ORIGINS.includes(req.headers.origin ?? '') &&
            (this.io?.engine.clientsCount ?? 0) < this.env.REALTIME_MAX_CONNECTIONS,
        ),
    });
    this.io.use((socket, next) => {
      void this.admit(socket).then(
        () => next(),
        () => next(new Error('REALTIME_UNAUTHORIZED')),
      );
    });
    this.io.on('connection', (socket) => {
      if (this.clients.size >= this.env.REALTIME_MAX_CONNECTIONS) {
        socket.disconnect(true);
        return;
      }
      this.clients.set(socket, (socket.data as { scope: Subscription }).scope);
      socket.on('disconnect', () => this.clients.delete(socket));
      // Server-assigned scope only. No inbound business command or room subscription.
      socket.onAny(() => socket.disconnect(true));
    });
    this.scheduleCheck();
  }

  private async admit(socket: Socket): Promise<void> {
    const auth = socket.handshake.auth as Record<string, unknown>;
    if (
      Object.hasOwn(socket.handshake.query, 'ticket') ||
      Object.keys(auth).some((key) => key !== 'ticket')
    )
      throw new Error();
    const scope = await this.tickets.consume(auth.ticket, socket.handshake.headers.origin);
    delete auth.ticket;
    if (!scope || this.stopping) throw new Error();
    (socket.data as { scope: Subscription }).scope = scope;
  }

  private scheduleCheck(): void {
    if (this.stopping) return;
    this.timer = setTimeout(() => {
      this.checking = this.revalidate().finally(() => this.scheduleCheck());
    }, 30_000);
    this.timer.unref();
  }

  async revalidate(): Promise<void> {
    for (const [socket, scope] of this.clients) {
      try {
        if (!(await this.tickets.authorize(scope))) socket.disconnect(true);
      } catch {
        socket.disconnect(true);
      }
    }
    try {
      await this.tickets.cleanup();
    } catch {
      this.logger.warn('REALTIME_CLEANUP_FAILED');
    }
  }

  async emit(event: ClaimedEvent): Promise<void> {
    if (!this.io || this.stopping) throw new Error('REALTIME_UNAVAILABLE');
    const hint = notification(event);
    for (const [socket, scope] of this.clients) {
      if (!matches(scope, event, hint.payload)) continue;
      // Every fanout rechecks DB authorization, not cached handshake permissions.
      try {
        if (!(await this.tickets.authorize(scope))) {
          socket.disconnect(true);
          continue;
        }
      } catch {
        socket.disconnect(true);
        throw new Error('REALTIME_AUTHORIZATION_UNAVAILABLE');
      }
      if (socket.connected) {
        if (!socket.conn.transport.writable) {
          socket.disconnect(true);
          throw new Error('REALTIME_BACKPRESSURE');
        }
        // Other browse devices may observe generic activation state, never the requester's private request ID.
        const data =
          scope.actorType === 'GUEST' && scope.audience === 'activation'
            ? { ...hint.data, resourceId: 'current-table' }
            : hint.data;
        socket.emit('invalidate', data);
      }
    }
    // Socket.IO enqueue success is NOT a receipt acknowledgement; reconnect refetches.
  }

  connectionCount(): number {
    return this.clients.size;
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    await this.checking;
    this.clients.clear();
    if (this.io) await this.io.close();
  }
}
