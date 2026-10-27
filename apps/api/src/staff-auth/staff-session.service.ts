import { Injectable } from '@nestjs/common';
import { StaffMembershipStatus, StaffUserStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../database/prisma.service.js';
import { STAFF_SESSION_TTL_MS } from './auth.constants.js';
import { generateOpaqueToken, hashToken } from './auth.crypto.js';
import type { LoginResult, StaffPrincipal } from './staff-auth.types.js';

@Injectable()
export class StaffSessionService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    staff: Omit<LoginResult['staff'], 'permissions'> & { permissions: readonly string[] },
    now = new Date(),
  ): Promise<LoginResult> {
    const sessionToken = generateOpaqueToken();
    const csrfToken = generateOpaqueToken();
    const expiresAt = new Date(now.getTime() + STAFF_SESSION_TTL_MS);

    await this.prisma.staffSession.create({
      data: {
        staffUserId: staff.id,
        membershipId: staff.membershipId,
        tokenHash: hashToken(sessionToken),
        csrfTokenHash: hashToken(csrfToken),
        expiresAt,
      },
    });

    return { sessionToken, csrfToken, expiresAt, staff };
  }

  async authenticate(
    rawToken: string | undefined,
    now = new Date(),
  ): Promise<StaffPrincipal | null> {
    if (!rawToken) return null;

    const session = await this.prisma.staffSession.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      select: {
        id: true,
        csrfTokenHash: true,
        expiresAt: true,
        revokedAt: true,
        staffUser: { select: { id: true, email: true, name: true, status: true } },
        membership: {
          select: {
            id: true,
            restaurantId: true,
            locationId: true,
            status: true,
            location: {
              select: {
                isActive: true,
                restaurant: { select: { status: true } },
              },
            },
            roles: {
              select: {
                role: {
                  select: {
                    permissions: { select: { permission: { select: { code: true } } } },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (
      !session ||
      session.revokedAt !== null ||
      session.expiresAt.getTime() <= now.getTime() ||
      session.staffUser.status !== StaffUserStatus.ACTIVE ||
      session.membership.status !== StaffMembershipStatus.ACTIVE ||
      !session.membership.location.isActive ||
      session.membership.location.restaurant.status !== 'ACTIVE'
    ) {
      return null;
    }

    const permissions = [
      ...new Set(
        session.membership.roles.flatMap(({ role }) =>
          role.permissions.map(({ permission }) => permission.code),
        ),
      ),
    ].sort();

    return {
      sessionId: session.id,
      staffUserId: session.staffUser.id,
      membershipId: session.membership.id,
      restaurantId: session.membership.restaurantId,
      locationId: session.membership.locationId,
      email: session.staffUser.email,
      name: session.staffUser.name,
      permissions,
      csrfTokenHash: session.csrfTokenHash,
    };
  }

  async revoke(sessionId: string, now = new Date()): Promise<void> {
    await this.prisma.staffSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: now },
    });
  }

  async replaceCsrfToken(principal: StaffPrincipal, now = new Date()): Promise<string | null> {
    const csrfToken = generateOpaqueToken();
    const updated = await this.prisma.staffSession.updateMany({
      where: {
        id: principal.sessionId,
        csrfTokenHash: principal.csrfTokenHash,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: { csrfTokenHash: hashToken(csrfToken) },
    });
    return updated.count === 1 ? csrfToken : null;
  }
}
