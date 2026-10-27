import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { StaffMembershipStatus, StaffUserStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../database/prisma.service.js';
import { generateOpaqueToken, hashPassword, verifyPassword } from './auth.crypto.js';
import { LoginRateLimiterService } from './login-rate-limiter.service.js';
import type { LoginResult } from './staff-auth.types.js';
import { StaffSessionService } from './staff-session.service.js';

export type StaffLoginInput = { email: string; password: string; locationId?: string | undefined };

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function authenticationFailed(): UnauthorizedException {
  return new UnauthorizedException({
    code: 'STAFF_AUTHENTICATION_FAILED',
    message: 'Unable to authenticate.',
    details: {},
  });
}

@Injectable()
export class StaffAuthService {
  private readonly dummyHash = hashPassword(generateOpaqueToken());

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LoginRateLimiterService) private readonly limiter: LoginRateLimiterService,
    @Inject(StaffSessionService) private readonly sessions: StaffSessionService,
  ) {}

  async login(input: StaffLoginInput, request: Request): Promise<LoginResult> {
    const email = normalizeEmail(input.email);
    const sourceIp = request.ip || request.socket.remoteAddress || 'unknown';
    const rateLimitKey = `${email}\u0000${sourceIp}`;

    if (this.limiter.isBlocked(rateLimitKey)) {
      throw new HttpException(
        {
          code: 'STAFF_LOGIN_RATE_LIMITED',
          message: 'Unable to authenticate.',
          details: {},
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.prisma.staffUser.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        name: true,
        status: true,
        memberships: {
          where: {
            status: StaffMembershipStatus.ACTIVE,
            ...(input.locationId ? { locationId: input.locationId } : {}),
            location: { isActive: true, restaurant: { status: 'ACTIVE' } },
          },
          take: 2,
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            restaurantId: true,
            locationId: true,
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

    const passwordHash = user?.passwordHash ?? (await this.dummyHash);
    const passwordValid = await verifyPassword(input.password, passwordHash);
    const membership = user?.memberships.length === 1 ? user.memberships[0] : undefined;

    if (!user || !passwordValid || user.status !== StaffUserStatus.ACTIVE || !membership) {
      this.limiter.recordFailure(rateLimitKey);
      throw authenticationFailed();
    }

    this.limiter.clear(rateLimitKey);
    const permissions = [
      ...new Set(
        membership.roles.flatMap(({ role }) =>
          role.permissions.map(({ permission }) => permission.code),
        ),
      ),
    ].sort();

    return this.sessions.create({
      id: user.id,
      email: user.email,
      name: user.name,
      membershipId: membership.id,
      restaurantId: membership.restaurantId,
      locationId: membership.locationId,
      permissions,
    });
  }
}
