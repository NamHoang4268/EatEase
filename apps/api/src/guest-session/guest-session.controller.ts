import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { OriginPolicyService } from '../staff-auth/origin-policy.service.js';
import { GuestCookieService } from './guest-cookie.service.js';
import { GuestSessionGuard } from './guest-session.guard.js';
import { GuestSessionService } from './guest-session.service.js';
import type { GuestRequest } from './guest-session.types.js';

const bootstrapSchema = z.object({
  tablePublicId: z.string().uuid(),
});

function parseBootstrapBody(body: unknown) {
  const result = bootstrapSchema.safeParse(body);
  if (!result.success) {
    throw new BadRequestException({
      code: 'GUEST_BOOTSTRAP_INVALID',
      message: 'Bootstrap request is invalid.',
      details: {},
    });
  }
  return result.data;
}

function principalFrom(request: GuestRequest) {
  if (!request.guestPrincipal) {
    throw new UnauthorizedException({
      code: 'GUEST_SESSION_INVALID',
      message: 'Guest session is missing, expired, or revoked.',
      details: {},
    });
  }
  return request.guestPrincipal;
}

@Controller('guest-sessions')
export class GuestSessionController {
  constructor(
    @Inject(GuestSessionService) private readonly sessions: GuestSessionService,
    @Inject(GuestCookieService) private readonly cookies: GuestCookieService,
    @Inject(OriginPolicyService) private readonly origins: OriginPolicyService,
  ) {}

  @Post()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async bootstrap(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.origins.assertTrusted(request);
    const { tablePublicId } = parseBootstrapBody(body);
    const existingToken = this.cookies.read(request);
    const result = await this.sessions.bootstrapSession({ tablePublicId }, existingToken);
    this.cookies.set(response, result.sessionToken, result.absoluteExpiresAt);
    return {
      data: {
        table: result.table,
        activationState: result.activationState,
        session: {
          accessLevel: result.accessLevel,
          idleExpiresAt: result.idleExpiresAt.toISOString(),
          absoluteExpiresAt: result.absoluteExpiresAt.toISOString(),
        },
        csrfToken: result.csrfToken,
      },
    };
  }

  @Get('csrf-token')
  @UseGuards(GuestSessionGuard)
  @Header('Cache-Control', 'no-store')
  async replaceCsrfToken(@Req() request: GuestRequest) {
    this.origins.assertTrusted(request);
    const csrfToken = await this.sessions.replaceCsrfToken(principalFrom(request));
    if (!csrfToken) {
      throw new UnauthorizedException({
        code: 'GUEST_SESSION_INVALID',
        message: 'Guest session is missing, expired, or revoked.',
        details: {},
      });
    }
    return { data: { csrfToken } };
  }

  @Get('current')
  @UseGuards(GuestSessionGuard)
  @Header('Cache-Control', 'no-store')
  current(@Req() request: GuestRequest) {
    const principal = principalFrom(request);
    return {
      data: {
        session: {
          accessLevel: principal.accessLevel,
          idleExpiresAt: principal.idleExpiresAt.toISOString(),
          absoluteExpiresAt: principal.absoluteExpiresAt.toISOString(),
        },
        table: {
          publicId: principal.tablePublicId,
        },
      },
    };
  }
}
