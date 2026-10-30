import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { GuestCsrfGuard } from '../guest-session/guest-csrf.guard.js';
import { GuestCookieService } from '../guest-session/guest-cookie.service.js';
import { GuestSessionGuard } from '../guest-session/guest-session.guard.js';
import type { GuestRequest } from '../guest-session/guest-session.types.js';
import { OriginPolicyService } from '../staff-auth/origin-policy.service.js';
import { RequirePermissions } from '../staff-auth/staff-authorization.js';
import { StaffAuthorizationGuard } from '../staff-auth/staff-authorization.guard.js';
import type { StaffRequest } from '../staff-auth/staff-auth.types.js';
import { StaffCsrfGuard } from '../staff-auth/staff-csrf.guard.js';
import { StaffSessionGuard } from '../staff-auth/staff-session.guard.js';
import { JoinCodeService } from './join-code.service.js';

const issueSchema = z
  .object({ expectedVersion: z.number().int().nonnegative(), replaceExisting: z.boolean() })
  .strict();
const revokeSchema = z.object({ expectedVersion: z.number().int().nonnegative() }).strict();
const joinSchema = z
  .object({ tablePublicId: z.string().uuid(), joinCode: z.string().regex(/^\d{6}$/) })
  .strict();
const sessionIdSchema = z.string().uuid();
const activeQuerySchema = z.object({ status: z.literal('ACTIVE') }).strict();

function badRequest(code: string, message: string): BadRequestException {
  return new BadRequestException({ code, message, details: {} });
}

function idempotencyKey(value: string | undefined): string {
  const key = value?.trim();
  if (!key || key.length > 128) throw badRequest('IDEMPOTENCY_KEY_INVALID', 'Invalid key.');
  return key;
}

function requiredHeader(value: string | string[] | undefined): string {
  const header = Array.isArray(value) ? undefined : value?.trim();
  if (!header) {
    throw new ForbiddenException({
      code: 'GUEST_CSRF_INVALID',
      message: 'A valid X-CSRF-Token header is required.',
      details: {},
    });
  }
  return header;
}

function guestPrincipal(request: GuestRequest) {
  if (!request.guestPrincipal) {
    throw new UnauthorizedException({
      code: 'GUEST_SESSION_INVALID',
      message: 'Guest session is invalid.',
      details: {},
    });
  }
  return request.guestPrincipal;
}

function staffPrincipal(request: StaffRequest) {
  if (!request.staffPrincipal) {
    throw new UnauthorizedException({
      code: 'STAFF_SESSION_INVALID',
      message: 'Staff session is invalid.',
      details: {},
    });
  }
  return request.staffPrincipal;
}

@Controller('table-sessions')
export class GuestJoinCodeController {
  constructor(
    @Inject(JoinCodeService) private readonly joinCodes: JoinCodeService,
    @Inject(GuestCookieService) private readonly cookies: GuestCookieService,
    @Inject(OriginPolicyService) private readonly origins: OriginPolicyService,
  ) {}

  @Post('join')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async join(
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.origins.assertTrusted(request);
    const parsed = joinSchema.safeParse(body);
    if (!parsed.success) throw badRequest('JOIN_REQUEST_INVALID', 'Join request is invalid.');
    const rawSessionToken = this.cookies.read(request);
    if (!rawSessionToken) throw new UnauthorizedException({ code: 'GUEST_SESSION_INVALID' });
    const result = await this.joinCodes.join({
      ...parsed.data,
      idempotencyKey: idempotencyKey(key),
      rawSessionToken,
      rawCsrfToken: requiredHeader(request.headers['x-csrf-token']),
      sourceIp: request.ip ?? 'unknown',
    });
    this.cookies.set(response, result.sessionToken, result.absoluteExpiresAt);
    return { data: { ...result.data, csrfToken: result.csrfToken } };
  }

  @Get('current/join-code')
  @UseGuards(GuestSessionGuard)
  @Header('Cache-Control', 'no-store')
  async current(@Req() request: GuestRequest) {
    return { data: await this.joinCodes.getHostMetadata(guestPrincipal(request)) };
  }

  @Post('current/join-code')
  @HttpCode(200)
  @UseGuards(GuestSessionGuard, GuestCsrfGuard)
  @Header('Cache-Control', 'no-store')
  async issue(
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: GuestRequest,
  ) {
    const parsed = issueSchema.safeParse(body);
    if (!parsed.success) throw badRequest('JOIN_CODE_ISSUE_INVALID', 'Issue request is invalid.');
    return {
      data: await this.joinCodes.issueForHost({
        ...parsed.data,
        idempotencyKey: idempotencyKey(key),
        principal: guestPrincipal(request),
      }),
    };
  }
}

@Controller('staff/table-sessions')
export class StaffJoinCodeController {
  constructor(@Inject(JoinCodeService) private readonly joinCodes: JoinCodeService) {}

  @Get()
  @UseGuards(StaffSessionGuard, StaffAuthorizationGuard)
  @RequirePermissions('table.session.read')
  @Header('Cache-Control', 'no-store')
  async list(@Query() query: unknown, @Req() request: StaffRequest) {
    const parsed = activeQuerySchema.safeParse(query);
    if (!parsed.success) throw badRequest('TABLE_SESSION_QUERY_INVALID', 'Invalid query.');
    return { data: await this.joinCodes.listActiveForStaff(staffPrincipal(request)) };
  }

  @Post(':id/join-code')
  @HttpCode(200)
  @UseGuards(StaffSessionGuard, StaffCsrfGuard, StaffAuthorizationGuard)
  @RequirePermissions('table.join_code.manage')
  @Header('Cache-Control', 'no-store')
  async issue(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: StaffRequest,
  ) {
    const sessionId = sessionIdSchema.safeParse(id);
    const parsed = issueSchema.safeParse(body);
    if (!sessionId.success || !parsed.success) {
      throw badRequest('JOIN_CODE_ISSUE_INVALID', 'Issue request is invalid.');
    }
    return {
      data: await this.joinCodes.issueForStaff({
        ...parsed.data,
        tableSessionId: sessionId.data,
        idempotencyKey: idempotencyKey(key),
        principal: staffPrincipal(request),
      }),
    };
  }

  @Delete(':id/join-code')
  @HttpCode(200)
  @UseGuards(StaffSessionGuard, StaffCsrfGuard, StaffAuthorizationGuard)
  @RequirePermissions('table.join_code.manage')
  @Header('Cache-Control', 'no-store')
  async revoke(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: StaffRequest,
  ) {
    const sessionId = sessionIdSchema.safeParse(id);
    const parsed = revokeSchema.safeParse(body);
    if (!sessionId.success || !parsed.success) {
      throw badRequest('JOIN_CODE_REVOKE_INVALID', 'Revoke request is invalid.');
    }
    return {
      data: await this.joinCodes.revokeForStaff({
        ...parsed.data,
        tableSessionId: sessionId.data,
        idempotencyKey: idempotencyKey(key),
        principal: staffPrincipal(request),
      }),
    };
  }
}
