import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Inject,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { GuestCsrfGuard } from '../guest-session/guest-csrf.guard.js';
import { GuestSessionGuard } from '../guest-session/guest-session.guard.js';
import type { GuestRequest } from '../guest-session/guest-session.types.js';
import { RequirePermissions } from '../staff-auth/staff-authorization.js';
import { StaffAuthorizationGuard } from '../staff-auth/staff-authorization.guard.js';
import type { StaffRequest } from '../staff-auth/staff-auth.types.js';
import { StaffSessionGuard } from '../staff-auth/staff-session.guard.js';
import { ActivationRequestService } from './activation-request.service.js';

const requestSchema = z.object({ tablePublicId: z.string().uuid() }).strict();
const queueSchema = z.object({ status: z.literal('PENDING') }).strict();

function guestPrincipal(request: GuestRequest) {
  if (!request.guestPrincipal) {
    throw new UnauthorizedException({
      code: 'GUEST_SESSION_INVALID',
      message: 'Guest session is missing, expired, or revoked.',
      details: {},
    });
  }
  return request.guestPrincipal;
}

function staffPrincipal(request: StaffRequest) {
  if (!request.staffPrincipal) {
    throw new UnauthorizedException({
      code: 'STAFF_SESSION_INVALID',
      message: 'Staff session is missing, expired, or revoked.',
      details: {},
    });
  }
  return request.staffPrincipal;
}

function parseRequest(body: unknown) {
  const result = requestSchema.safeParse(body);
  if (!result.success) {
    throw new BadRequestException({
      code: 'ACTIVATION_REQUEST_INVALID',
      message: 'Activation request is invalid.',
      details: {},
    });
  }
  return result.data;
}

function parseIdempotencyKey(value: string | undefined): string {
  const key = value?.trim();
  if (!key || key.length > 128) {
    throw new BadRequestException({
      code: 'IDEMPOTENCY_KEY_INVALID',
      message: 'A valid Idempotency-Key header is required.',
      details: {},
    });
  }
  return key;
}

@Controller('activation-requests')
export class GuestActivationRequestController {
  constructor(
    @Inject(ActivationRequestService) private readonly activations: ActivationRequestService,
  ) {}

  @Post()
  @UseGuards(GuestSessionGuard, GuestCsrfGuard)
  @Header('Cache-Control', 'no-store')
  async create(
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: GuestRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const input = parseRequest(body);
    const result = await this.activations.requestActivation({
      ...input,
      idempotencyKey: parseIdempotencyKey(idempotencyKey),
      principal: guestPrincipal(request),
    });
    response.status(result.statusCode);
    return { data: result.data };
  }

  @Get('current')
  @UseGuards(GuestSessionGuard)
  @Header('Cache-Control', 'no-store')
  async current(@Req() request: GuestRequest) {
    return { data: await this.activations.getCurrent(guestPrincipal(request)) };
  }
}

@Controller('staff/activation-requests')
export class StaffActivationRequestController {
  constructor(
    @Inject(ActivationRequestService) private readonly activations: ActivationRequestService,
  ) {}

  @Get()
  @UseGuards(StaffSessionGuard, StaffAuthorizationGuard)
  @RequirePermissions('table.activation.read')
  @Header('Cache-Control', 'no-store')
  async queue(@Query() query: unknown, @Req() request: StaffRequest) {
    const result = queueSchema.safeParse(query);
    if (!result.success) {
      throw new BadRequestException({
        code: 'ACTIVATION_QUEUE_QUERY_INVALID',
        message: 'Only the PENDING activation queue is available.',
        details: {},
      });
    }
    return {
      data: await this.activations.getStaffQueue({
        status: result.data.status,
        principal: staffPrincipal(request),
      }),
    };
  }
}
