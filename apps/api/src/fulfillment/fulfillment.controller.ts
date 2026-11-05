import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
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
import { StaffCsrfGuard } from '../staff-auth/staff-csrf.guard.js';
import { parseStartPreparation } from './start-preparation.contract.js';
import { StartPreparationService } from './start-preparation.service.js';

@Controller('staff/fulfillment/items')
export class FulfillmentController {
  constructor(
    @Inject(FulfillmentService) private readonly fulfillment: FulfillmentService,
    @Inject(StartPreparationService) private readonly preparation: StartPreparationService,
  ) {}

  @Post(':id/start-preparation')
  @HttpCode(200)
  @UseGuards(StaffSessionGuard, StaffCsrfGuard, StaffAuthorizationGuard)
  @RequirePermissions('fulfillment.transition')
  @Header('Cache-Control', 'no-store')
  async startPreparation(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: StaffRequest,
  ) {
    if (!request.staffPrincipal) throw new UnauthorizedException({ code: 'STAFF_SESSION_INVALID' });
    return {
      data: await this.preparation.start(
        request.staffPrincipal,
        parseStartPreparation(id, body, key),
      ),
    };
  }

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
