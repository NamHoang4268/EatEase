import {
  Body,
  Controller,
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
import { GuestCsrfGuard } from '../guest-session/guest-csrf.guard.js';
import { GuestSessionGuard } from '../guest-session/guest-session.guard.js';
import type { GuestRequest } from '../guest-session/guest-session.types.js';
import { RequirePermissions } from '../staff-auth/staff-authorization.js';
import { StaffAuthorizationGuard } from '../staff-auth/staff-authorization.guard.js';
import type { StaffRequest } from '../staff-auth/staff-auth.types.js';
import { StaffCsrfGuard } from '../staff-auth/staff-csrf.guard.js';
import { StaffSessionGuard } from '../staff-auth/staff-session.guard.js';
import {
  parseCancellationDecision,
  parseCancellationForward,
  parseDirectRejection,
  parseGuestCancellation,
  parseManagerCorrection,
} from './cancellation.contract.js';
import { CancellationService } from './cancellation.service.js';

function guest(request: GuestRequest) {
  if (!request.guestPrincipal) throw new UnauthorizedException({ code: 'GUEST_SESSION_INVALID' });
  return request.guestPrincipal;
}

function staff(request: StaffRequest) {
  if (!request.staffPrincipal) throw new UnauthorizedException({ code: 'STAFF_SESSION_INVALID' });
  return request.staffPrincipal;
}

@Controller()
export class CancellationController {
  constructor(@Inject(CancellationService) private readonly cancellation: CancellationService) {}

  @Post('orders/items/:id/cancellation-requests')
  @HttpCode(201)
  @UseGuards(GuestSessionGuard, GuestCsrfGuard)
  @Header('Cache-Control', 'no-store')
  async request(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: GuestRequest,
  ) {
    return {
      data: await this.cancellation.requestGuest(
        guest(request),
        parseGuestCancellation(id, body, key),
      ),
    };
  }

  @Post('staff/cancellation-requests/:id/waiter-decision')
  @HttpCode(200)
  @UseGuards(StaffSessionGuard, StaffCsrfGuard, StaffAuthorizationGuard)
  @RequirePermissions('order.cancel_new')
  @Header('Cache-Control', 'no-store')
  async decideWaiter(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: StaffRequest,
  ) {
    return {
      data: await this.cancellation.decideWaiter(
        staff(request),
        parseCancellationDecision(id, body, key),
      ),
    };
  }

  @Post('staff/cancellation-requests/:id/forward-to-kitchen')
  @HttpCode(200)
  @UseGuards(StaffSessionGuard, StaffCsrfGuard, StaffAuthorizationGuard)
  @RequirePermissions('cancellation.forward_to_kitchen')
  @Header('Cache-Control', 'no-store')
  async forward(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: StaffRequest,
  ) {
    return {
      data: await this.cancellation.forward(
        staff(request),
        parseCancellationForward(id, body, key),
      ),
    };
  }

  @Post('staff/cancellation-requests/:id/operational-decision')
  @HttpCode(200)
  @UseGuards(StaffSessionGuard, StaffCsrfGuard, StaffAuthorizationGuard)
  @RequirePermissions('cancellation.decide_operational')
  @Header('Cache-Control', 'no-store')
  async decideOperational(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: StaffRequest,
  ) {
    return {
      data: await this.cancellation.decideOperational(
        staff(request),
        parseCancellationDecision(id, body, key),
      ),
    };
  }

  @Post('staff/fulfillment/items/:id/reject')
  @HttpCode(200)
  @UseGuards(StaffSessionGuard, StaffCsrfGuard, StaffAuthorizationGuard)
  @RequirePermissions('cancellation.decide_operational')
  @Header('Cache-Control', 'no-store')
  async rejectItem(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: StaffRequest,
  ) {
    return {
      data: await this.cancellation.rejectNewItem(
        staff(request),
        parseDirectRejection(id, body, key),
      ),
    };
  }

  @Post('staff/fulfillment/items/:id/manager-correction')
  @HttpCode(200)
  @UseGuards(StaffSessionGuard, StaffCsrfGuard, StaffAuthorizationGuard)
  @RequirePermissions('bill.adjust')
  @Header('Cache-Control', 'no-store')
  async correctItem(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: StaffRequest,
  ) {
    return {
      data: await this.cancellation.correctItem(
        staff(request),
        parseManagerCorrection(id, body, key),
      ),
    };
  }
}
