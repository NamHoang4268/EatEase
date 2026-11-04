import {
  Controller,
  Get,
  Header,
  Inject,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { RequirePermissions } from '../staff-auth/staff-authorization.js';
import { StaffAuthorizationGuard } from '../staff-auth/staff-authorization.guard.js';
import type { StaffRequest } from '../staff-auth/staff-auth.types.js';
import { StaffSessionGuard } from '../staff-auth/staff-session.guard.js';
import { parseFulfillmentQuery } from './fulfillment-query.js';
import { FulfillmentService } from './fulfillment.service.js';

@Controller('staff/fulfillment/items')
export class FulfillmentController {
  constructor(@Inject(FulfillmentService) private readonly fulfillment: FulfillmentService) {}

  @Get()
  @UseGuards(StaffSessionGuard, StaffAuthorizationGuard)
  @RequirePermissions('fulfillment.read')
  @Header('Cache-Control', 'no-store')
  async list(@Query() query: unknown, @Req() request: StaffRequest) {
    if (!request.staffPrincipal) throw new UnauthorizedException({ code: 'STAFF_SESSION_INVALID' });
    return {
      data: await this.fulfillment.list(request.staffPrincipal, parseFulfillmentQuery(query)),
    };
  }
}
