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
import { OriginPolicyService } from './origin-policy.service.js';
import { StaffAuthService } from './staff-auth.service.js';
import type { StaffRequest } from './staff-auth.types.js';
import { StaffCookieService } from './staff-cookie.service.js';
import { StaffCsrfGuard } from './staff-csrf.guard.js';
import { StaffSessionGuard } from './staff-session.guard.js';
import { StaffSessionService } from './staff-session.service.js';

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(320)),
  password: z.string().min(1).max(256),
  locationId: z.uuid().optional(),
});

function parseLoginBody(body: unknown) {
  const result = loginSchema.safeParse(body);
  if (!result.success) {
    throw new BadRequestException({
      code: 'STAFF_LOGIN_INVALID',
      message: 'Login request is invalid.',
      details: {},
    });
  }
  return result.data;
}

function principalFrom(request: StaffRequest) {
  if (!request.staffPrincipal) {
    throw new UnauthorizedException({
      code: 'STAFF_SESSION_INVALID',
      message: 'Staff session is missing, expired, or revoked.',
      details: {},
    });
  }
  return request.staffPrincipal;
}

@Controller('staff/auth')
export class StaffAuthController {
  constructor(
    @Inject(StaffAuthService) private readonly auth: StaffAuthService,
    @Inject(StaffSessionService) private readonly sessions: StaffSessionService,
    @Inject(StaffCookieService) private readonly cookies: StaffCookieService,
    @Inject(OriginPolicyService) private readonly origins: OriginPolicyService,
  ) {}

  @Post('login')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async login(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.origins.assertTrusted(request);
    const result = await this.auth.login(parseLoginBody(body), request);
    this.cookies.set(response, result.sessionToken);
    return {
      data: {
        staff: result.staff,
        expiresAt: result.expiresAt.toISOString(),
        csrfToken: result.csrfToken,
      },
    };
  }

  @Get('me')
  @UseGuards(StaffSessionGuard)
  @Header('Cache-Control', 'no-store')
  me(@Req() request: StaffRequest) {
    const principal = principalFrom(request);
    return {
      data: {
        staff: {
          id: principal.staffUserId,
          email: principal.email,
          name: principal.name,
          membershipId: principal.membershipId,
          restaurantId: principal.restaurantId,
          locationId: principal.locationId,
          permissions: principal.permissions,
        },
      },
    };
  }

  @Get('csrf-token')
  @UseGuards(StaffSessionGuard)
  @Header('Cache-Control', 'no-store')
  async replaceCsrfToken(@Req() request: StaffRequest) {
    this.origins.assertTrusted(request);
    const csrfToken = await this.sessions.replaceCsrfToken(principalFrom(request));
    if (!csrfToken) throw new UnauthorizedException();
    return { data: { csrfToken } };
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(StaffSessionGuard, StaffCsrfGuard)
  @Header('Cache-Control', 'no-store')
  async logout(
    @Req() request: StaffRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.sessions.revoke(principalFrom(request).sessionId);
    this.cookies.clear(response);
  }
}
