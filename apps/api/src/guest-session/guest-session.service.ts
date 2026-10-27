import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PublicTableAvailability } from '../catalog/public-catalog.contract.js';
import { loadEnvironment } from '../config/environment.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  GuestAccessLevel,
  RestaurantStatus,
  TablePhysicalStatus,
} from '../generated/prisma/enums.js';
import { generateOpaqueToken, hashToken } from '../staff-auth/auth.crypto.js';
import type { GuestBootstrapResult, GuestPrincipal } from './guest-session.types.js';

function mapAvailability(status: TablePhysicalStatus): PublicTableAvailability {
  switch (status) {
    case TablePhysicalStatus.AVAILABLE:
      return 'AVAILABLE';
    case TablePhysicalStatus.OCCUPIED:
      return 'BROWSE_ONLY';
    case TablePhysicalStatus.CLEANING:
    case TablePhysicalStatus.OUT_OF_SERVICE:
      return 'UNAVAILABLE';
  }
}

function tableNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'PUBLIC_TABLE_NOT_FOUND',
    message: 'Không tìm thấy bàn đang hoạt động.',
    details: {},
  });
}

@Injectable()
export class GuestSessionService {
  private readonly idleTimeoutMs: number;
  private readonly absoluteTimeoutMs: number;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    let idle: number | undefined;
    let absolute: number | undefined;
    try {
      const environment = loadEnvironment();
      idle = environment.GUEST_IDLE_TIMEOUT_MINUTES;
      absolute = environment.GUEST_ABSOLUTE_TIMEOUT_HOURS;
    } catch {
      idle = 30;
      absolute = 8;
    }
    this.idleTimeoutMs = (idle ?? 30) * 60 * 1_000;
    this.absoluteTimeoutMs = (absolute ?? 8) * 60 * 60 * 1_000;
  }

  async bootstrapSession(
    input: { tablePublicId: string },
    existingRawToken?: string,
    now = new Date(),
  ): Promise<GuestBootstrapResult> {
    const table = await this.prisma.restaurantTable.findFirst({
      where: {
        publicId: input.tablePublicId,
        isActive: true,
        location: {
          isActive: true,
          restaurant: { status: RestaurantStatus.ACTIVE },
        },
      },
      select: {
        id: true,
        restaurantId: true,
        locationId: true,
        publicId: true,
        code: true,
        capacity: true,
        physicalStatus: true,
        location: {
          select: {
            name: true,
            restaurant: { select: { name: true } },
          },
        },
      },
    });

    if (!table) {
      throw tableNotFound();
    }

    const tableContext = {
      publicId: table.publicId,
      restaurantName: table.location.restaurant.name,
      locationName: table.location.name,
      tableLabel: table.code,
      capacity: table.capacity,
      availability: mapAvailability(table.physicalStatus),
    };

    if (existingRawToken) {
      const existingHash = hashToken(existingRawToken);
      const existing = await this.prisma.guestSession.findUnique({
        where: { tokenHash: existingHash },
        select: {
          id: true,
          tableId: true,
          accessLevel: true,
          idleExpiresAt: true,
          absoluteExpiresAt: true,
          revokedAt: true,
        },
      });

      if (
        existing &&
        existing.tableId === table.id &&
        existing.revokedAt === null &&
        existing.idleExpiresAt.getTime() > now.getTime() &&
        existing.absoluteExpiresAt.getTime() > now.getTime()
      ) {
        const nextIdleExpiresAt = new Date(
          Math.min(now.getTime() + this.idleTimeoutMs, existing.absoluteExpiresAt.getTime()),
        );
        const csrfToken = generateOpaqueToken();

        await this.prisma.guestSession.update({
          where: { id: existing.id },
          data: {
            csrfTokenHash: hashToken(csrfToken),
            idleExpiresAt: nextIdleExpiresAt,
            lastSeenAt: now,
          },
        });

        return {
          sessionToken: existingRawToken,
          csrfToken,
          idleExpiresAt: nextIdleExpiresAt,
          absoluteExpiresAt: existing.absoluteExpiresAt,
          accessLevel: existing.accessLevel,
          table: tableContext,
          activationState: 'NOT_REQUESTED',
        };
      }
    }

    const sessionToken = generateOpaqueToken();
    const csrfToken = generateOpaqueToken();
    const absoluteExpiresAt = new Date(now.getTime() + this.absoluteTimeoutMs);
    const idleExpiresAt = new Date(
      Math.min(now.getTime() + this.idleTimeoutMs, absoluteExpiresAt.getTime()),
    );

    await this.prisma.guestSession.create({
      data: {
        restaurantId: table.restaurantId,
        locationId: table.locationId,
        tableId: table.id,
        tokenHash: hashToken(sessionToken),
        csrfTokenHash: hashToken(csrfToken),
        accessLevel: GuestAccessLevel.BROWSE_ONLY,
        idleExpiresAt,
        absoluteExpiresAt,
        lastSeenAt: now,
      },
    });

    return {
      sessionToken,
      csrfToken,
      idleExpiresAt,
      absoluteExpiresAt,
      accessLevel: GuestAccessLevel.BROWSE_ONLY,
      table: tableContext,
      activationState: 'NOT_REQUESTED',
    };
  }

  async authenticate(
    rawToken: string | undefined,
    now = new Date(),
  ): Promise<GuestPrincipal | null> {
    if (!rawToken) {
      return null;
    }

    const session = await this.prisma.guestSession.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      select: {
        id: true,
        restaurantId: true,
        locationId: true,
        tableId: true,
        accessLevel: true,
        idleExpiresAt: true,
        absoluteExpiresAt: true,
        revokedAt: true,
        csrfTokenHash: true,
        table: {
          select: {
            publicId: true,
            isActive: true,
            location: {
              select: {
                isActive: true,
                restaurant: { select: { status: true } },
              },
            },
          },
        },
      },
    });

    if (
      !session ||
      session.revokedAt !== null ||
      session.idleExpiresAt.getTime() <= now.getTime() ||
      session.absoluteExpiresAt.getTime() <= now.getTime() ||
      !session.table.isActive ||
      !session.table.location.isActive ||
      session.table.location.restaurant.status !== RestaurantStatus.ACTIVE
    ) {
      return null;
    }

    return {
      sessionId: session.id,
      restaurantId: session.restaurantId,
      locationId: session.locationId,
      tableId: session.tableId,
      tablePublicId: session.table.publicId,
      accessLevel: session.accessLevel,
      idleExpiresAt: session.idleExpiresAt,
      absoluteExpiresAt: session.absoluteExpiresAt,
      csrfTokenHash: session.csrfTokenHash,
    };
  }

  async replaceCsrfToken(principal: GuestPrincipal, now = new Date()): Promise<string | null> {
    const csrfToken = generateOpaqueToken();
    const updated = await this.prisma.guestSession.updateMany({
      where: {
        id: principal.sessionId,
        csrfTokenHash: principal.csrfTokenHash,
        revokedAt: null,
        idleExpiresAt: { gt: now },
        absoluteExpiresAt: { gt: now },
      },
      data: {
        csrfTokenHash: hashToken(csrfToken),
        lastSeenAt: now,
      },
    });

    return updated.count === 1 ? csrfToken : null;
  }

  async revoke(sessionId: string, now = new Date()): Promise<void> {
    await this.prisma.guestSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: now },
    });
  }
}
