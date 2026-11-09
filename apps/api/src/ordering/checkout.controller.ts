import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
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
import { GuestSessionGuard } from '../guest-session/guest-session.guard.js';
import { GuestCsrfGuard } from '../guest-session/guest-csrf.guard.js';
import type { GuestRequest } from '../guest-session/guest-session.types.js';
import { StaffSessionGuard } from '../staff-auth/staff-session.guard.js';
import { StaffCsrfGuard } from '../staff-auth/staff-csrf.guard.js';
import { StaffAuthorizationGuard } from '../staff-auth/staff-authorization.guard.js';
import { RequirePermissions } from '../staff-auth/staff-authorization.js';
import type { StaffRequest } from '../staff-auth/staff-auth.types.js';
import { checkoutBodySchema } from './checkout.contract.js';
import { CheckoutService } from './checkout.service.js';

function input(sessionId: string, value: unknown, key: string | undefined) {
  const body = checkoutBodySchema.safeParse(value);
  if (
    !z.uuid().safeParse(sessionId).success ||
    !body.success ||
    !key?.trim() ||
    key.trim().length > 128
  ) {
    throw new BadRequestException({ code: 'CHECKOUT_REQUEST_INVALID' });
  }
  return { ...body.data, tableSessionId: sessionId, idempotencyKey: key.trim() };
}

@Controller()
export class CheckoutController {
  constructor(@Inject(CheckoutService) private readonly checkout: CheckoutService) {}

  @Post('table-sessions/current/checkout')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseGuards(GuestSessionGuard, GuestCsrfGuard)
  async guest(
    @Req() request: GuestRequest,
    @Body() value: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const principal = request.guestPrincipal;
    if (!principal) throw new UnauthorizedException({ code: 'GUEST_SESSION_INVALID' });
    if (!principal.tableSessionId || principal.accessLevel !== 'ORDER_ENABLED')
      throw new ForbiddenException({ code: 'CHECKOUT_SCOPE_DENIED' });
    return {
      data: await this.checkout.checkoutGuest(
        principal,
        input(principal.tableSessionId, value, key),
      ),
    };
  }

  @Post('staff/table-sessions/:sessionId/checkout')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseGuards(StaffSessionGuard, StaffCsrfGuard, StaffAuthorizationGuard)
  @RequirePermissions('bill.checkout')
  async staff(
    @Req() request: StaffRequest,
    @Param('sessionId') sessionId: string,
    @Body() value: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    if (!request.staffPrincipal) throw new UnauthorizedException({ code: 'STAFF_SESSION_INVALID' });
    return {
      data: await this.checkout.checkoutStaff(request.staffPrincipal, input(sessionId, value, key)),
    };
  }

  @Post('staff/table-sessions/:sessionId/resume-ordering')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseGuards(StaffSessionGuard, StaffCsrfGuard, StaffAuthorizationGuard)
  @RequirePermissions('bill.checkout')
  async resume(
    @Req() request: StaffRequest,
    @Param('sessionId') sessionId: string,
    @Body() value: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    if (!request.staffPrincipal) throw new UnauthorizedException({ code: 'STAFF_SESSION_INVALID' });
    return {
      data: await this.checkout.resume(request.staffPrincipal, input(sessionId, value, key)),
    };
  }
}
