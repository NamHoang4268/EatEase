import {
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  HttpException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { loadEnvironment } from '../config/environment.js';
import { PrismaService } from '../database/prisma.service.js';
import { hashToken } from '../staff-auth/auth.crypto.js';
import { StaffSessionService } from '../staff-auth/staff-session.service.js';
import { GuestSessionService } from '../guest-session/guest-session.service.js';
import { permissionFor, type Subscription } from './realtime.contract.js';

@Injectable()
export class RealtimeTicketService {
  private readonly env = loadEnvironment();
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(StaffSessionService) private readonly staff: StaffSessionService,
    @Inject(GuestSessionService) private readonly guest: GuestSessionService,
  ) {}

  async authorize(scope: Subscription): Promise<boolean> {
    if (!this.env.TRUSTED_WEB_ORIGINS.includes(scope.origin)) return false;
    if (scope.actorType === 'STAFF') {
      const principal = await this.staff.authenticateSessionId(scope.actorSessionId);
      if (
        !principal ||
        principal.restaurantId !== scope.restaurantId ||
        principal.locationId !== scope.locationId ||
        !principal.permissions.includes(permissionFor[scope.audience])
      )
        return false;
      if (scope.audience !== 'bill') return scope.resourceId === null;
    } else {
      const principal = await this.guest.authenticateSessionId(scope.actorSessionId);
      if (
        !principal ||
        principal.restaurantId !== scope.restaurantId ||
        principal.locationId !== scope.locationId
      )
        return false;
      if (scope.audience === 'activation') {
        if (principal.tableId !== scope.resourceId) return false;
        if (!principal.tableSessionId) return true;
        return (
          (await this.prisma.tableSession.count({
            where: {
              id: principal.tableSessionId,
              restaurantId: scope.restaurantId,
              locationId: scope.locationId,
              status: { in: ['ACTIVE', 'CHECKOUT_LOCKED'] },
            },
          })) === 1
        );
      }
      if (
        scope.audience !== 'bill' ||
        principal.accessLevel !== 'ORDER_ENABLED' ||
        principal.tableSessionId !== scope.resourceId
      )
        return false;
    }
    if (!scope.resourceId) return false;
    return (
      (await this.prisma.tableSession.count({
        where: {
          id: scope.resourceId,
          restaurantId: scope.restaurantId,
          locationId: scope.locationId,
          status: { in: ['ACTIVE', 'CHECKOUT_LOCKED'] },
        },
      })) === 1
    );
  }

  async issue(scope: Subscription) {
    if (!this.env.REALTIME_ENABLED)
      throw new ServiceUnavailableException({ code: 'REALTIME_DISABLED' });
    if (!(await this.authorize(scope)))
      throw new ForbiddenException({ code: 'REALTIME_FORBIDDEN' });
    const token = randomBytes(32).toString('base64url');
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + 30_000);
    await this.prisma.$transaction(async (tx) => {
      // Serializes issuance for one actor, including concurrent requests.
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${scope.actorType + ':' + scope.actorSessionId}, 0))`;
      const count = await tx.realtimeTicket.count({
        where: {
          actorType: scope.actorType,
          actorSessionId: scope.actorSessionId,
          consumedAt: null,
          expiresAt: { gt: createdAt },
        },
      });
      if (count >= 4) throw new HttpException({ code: 'REALTIME_TICKET_RATE_LIMITED' }, 429);
      await tx.realtimeTicket.create({
        data: { ...scope, tokenHash: hashToken(token), createdAt, expiresAt },
      });
    });
    return {
      ticket: token,
      expiresAt: expiresAt.toISOString(),
      url: this.env.REALTIME_PUBLIC_URL!,
    };
  }

  async consume(raw: unknown, origin: string | undefined): Promise<Subscription | null> {
    if (
      !this.env.REALTIME_ENABLED ||
      typeof raw !== 'string' ||
      !/^[\w-]{43}$/.test(raw) ||
      !origin ||
      !this.env.TRUSTED_WEB_ORIGINS.includes(origin)
    )
      return null;
    // PostgreSQL wall clock is re-evaluated after lock waits; stale app time cannot extend TTL.
    const rows = await this.prisma.$queryRaw<Subscription[]>`
      UPDATE realtime_ticket SET consumed_at = clock_timestamp()
      WHERE token_hash = ${hashToken(raw)} AND origin = ${origin}
        AND consumed_at IS NULL AND expires_at > clock_timestamp()
      RETURNING actor_type AS "actorType", actor_session_id AS "actorSessionId",
        restaurant_id AS "restaurantId", location_id AS "locationId", audience,
        resource_id AS "resourceId", origin`;
    const scope = rows[0];
    if (!scope) return null;
    return (await this.authorize(scope)) ? scope : null;
  }

  async cleanup() {
    // Bounded cleanup; never log tokens or ticket records.
    await this.prisma.$executeRaw`DELETE FROM realtime_ticket WHERE id IN (
      SELECT id FROM realtime_ticket WHERE expires_at < now() - interval '1 minute' ORDER BY expires_at LIMIT 500
    )`;
  }
}
