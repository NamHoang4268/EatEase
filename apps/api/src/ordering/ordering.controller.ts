import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { GuestCsrfGuard } from '../guest-session/guest-csrf.guard.js';
import { GuestSessionGuard } from '../guest-session/guest-session.guard.js';
import type { GuestRequest } from '../guest-session/guest-session.types.js';
import { RequirePermissions } from '../staff-auth/staff-authorization.js';
import { StaffAuthorizationGuard } from '../staff-auth/staff-authorization.guard.js';
import type { StaffRequest } from '../staff-auth/staff-auth.types.js';
import { StaffCsrfGuard } from '../staff-auth/staff-csrf.guard.js';
import { StaffSessionGuard } from '../staff-auth/staff-session.guard.js';
import { submitOrderBodySchema } from './ordering.contract.js';
import { OrderingService } from './ordering.service.js';

const sessionIdSchema = z.uuid();

function badRequest(code: string, message: string): BadRequestException {
  return new BadRequestException({ code, message, details: {} });
}

function idempotencyKey(value: string | undefined): string {
  const key = value?.trim();
  if (!key || key.length > 128) throw badRequest('IDEMPOTENCY_KEY_INVALID', 'Invalid key.');
  return key;
}

function body(value: unknown) {
  const parsed = submitOrderBodySchema.safeParse(value);
  if (!parsed.success) throw badRequest('ORDER_SUBMISSION_INVALID', 'Order is invalid.');
  return parsed.data;
}

function guest(request: GuestRequest) {
  if (!request.guestPrincipal) throw new UnauthorizedException({ code: 'GUEST_SESSION_INVALID' });
  return request.guestPrincipal;
}

function staff(request: StaffRequest) {
  if (!request.staffPrincipal) throw new UnauthorizedException({ code: 'STAFF_SESSION_INVALID' });
  return request.staffPrincipal;
}

@Controller()
export class OrderingController {
  constructor(@Inject(OrderingService) private readonly ordering: OrderingService) {}

  @Post('orders')
  @HttpCode(201)
  @UseGuards(GuestSessionGuard, GuestCsrfGuard)
  @Header('Cache-Control', 'no-store')
  async submitGuest(
    @Body() value: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: GuestRequest,
  ) {
    return {
      data: await this.ordering.submitGuest(guest(request), body(value), idempotencyKey(key)),
    };
  }

  @Post('staff/table-sessions/:sessionId/orders')
  @HttpCode(201)
  @UseGuards(StaffSessionGuard, StaffCsrfGuard, StaffAuthorizationGuard)
  @RequirePermissions('order.create_for_table')
  @Header('Cache-Control', 'no-store')
  async submitStaff(
    @Param('sessionId') sessionId: string,
    @Body() value: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: StaffRequest,
  ) {
    const parsedId = sessionIdSchema.safeParse(sessionId);
    if (!parsedId.success) throw badRequest('TABLE_SESSION_ID_INVALID', 'Invalid session ID.');
    return {
      data: await this.ordering.submitStaff(
        staff(request),
        parsedId.data,
        body(value),
        idempotencyKey(key),
      ),
    };
  }

  @Get('table-sessions/current')
  @UseGuards(GuestSessionGuard)
  @Header('Cache-Control', 'no-store')
  async currentGuest(@Req() request: GuestRequest) {
    return { data: await this.ordering.currentForGuest(guest(request)) };
  }

  @Get('staff/table-sessions/:sessionId/bill')
  @UseGuards(StaffSessionGuard, StaffAuthorizationGuard)
  @RequirePermissions('bill.read')
  @Header('Cache-Control', 'no-store')
  async currentStaff(@Param('sessionId') sessionId: string, @Req() request: StaffRequest) {
    const parsedId = sessionIdSchema.safeParse(sessionId);
    if (!parsedId.success) throw badRequest('TABLE_SESSION_ID_INVALID', 'Invalid session ID.');
    return { data: await this.ordering.currentForStaff(staff(request), parsedId.data) };
  }
}
