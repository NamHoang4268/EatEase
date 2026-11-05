import {
  Body,
  Controller,
  Header,
  HttpCode,
  Inject,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { StaffSessionGuard } from '../staff-auth/staff-session.guard.js';
import { StaffCsrfGuard } from '../staff-auth/staff-csrf.guard.js';
import type { StaffRequest } from '../staff-auth/staff-auth.types.js';
import { GuestSessionGuard } from '../guest-session/guest-session.guard.js';
import { GuestCsrfGuard } from '../guest-session/guest-csrf.guard.js';
import type { GuestRequest } from '../guest-session/guest-session.types.js';
import { ticketBody } from './realtime.contract.js';
import { RealtimeTicketService } from './realtime-ticket.service.js';

@Controller()
export class RealtimeController {
  constructor(@Inject(RealtimeTicketService) private readonly tickets: RealtimeTicketService) {}

  @Post('staff/realtime/tickets')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @UseGuards(StaffSessionGuard, StaffCsrfGuard)
  async staff(@Body() body: unknown, @Req() request: StaffRequest) {
    const principal = request.staffPrincipal;
    if (!principal) throw new UnauthorizedException();
    const input = ticketBody(body);
    if ((input.audience === 'bill') !== Boolean(input.tableSessionId))
      throw new BadRequestException({ code: 'REALTIME_REQUEST_INVALID' });
    return {
      data: await this.tickets.issue({
        actorType: 'STAFF',
        actorSessionId: principal.sessionId,
        audience: input.audience,
        restaurantId: principal.restaurantId,
        locationId: principal.locationId,
        resourceId: input.tableSessionId ?? null,
        origin: request.headers.origin!,
      }),
    };
  }

  @Post('guest/realtime/tickets')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @UseGuards(GuestSessionGuard, GuestCsrfGuard)
  async guest(@Body() body: unknown, @Req() request: GuestRequest) {
    const principal = request.guestPrincipal;
    if (!principal) throw new UnauthorizedException();
    const input = ticketBody(body);
    if (input.tableSessionId || !['activation', 'bill'].includes(input.audience))
      throw new BadRequestException({ code: 'REALTIME_REQUEST_INVALID' });
    return {
      data: await this.tickets.issue({
        actorType: 'GUEST',
        actorSessionId: principal.sessionId,
        audience: input.audience,
        restaurantId: principal.restaurantId,
        locationId: principal.locationId,
        resourceId:
          input.audience === 'bill' ? (principal.tableSessionId ?? null) : principal.tableId,
        origin: request.headers.origin!,
      }),
    };
  }
}
