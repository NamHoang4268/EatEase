import {
  BadRequestException,
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
import { z } from 'zod';
import { RequirePermissions } from '../staff-auth/staff-authorization.js';
import { StaffAuthorizationGuard } from '../staff-auth/staff-authorization.guard.js';
import { StaffCsrfGuard } from '../staff-auth/staff-csrf.guard.js';
import { StaffSessionGuard } from '../staff-auth/staff-session.guard.js';
import type { StaffRequest } from '../staff-auth/staff-auth.types.js';
import { cashPaymentBodySchema } from './cash-payment.contract.js';
import { CashPaymentService } from './cash-payment.service.js';

@Controller('staff/table-sessions')
export class CashPaymentController {
  constructor(@Inject(CashPaymentService) private readonly payments: CashPaymentService) {}

  @Post(':sessionId/cash-payment')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseGuards(StaffSessionGuard, StaffCsrfGuard, StaffAuthorizationGuard)
  @RequirePermissions('payment.cash_record')
  async record(
    @Req() request: StaffRequest,
    @Param('sessionId') sessionId: string,
    @Body() value: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    if (!request.staffPrincipal) throw new UnauthorizedException({ code: 'STAFF_SESSION_INVALID' });
    const body = cashPaymentBodySchema.safeParse(value);
    if (
      !z.uuid().safeParse(sessionId).success ||
      !body.success ||
      !key?.trim() ||
      key.trim().length > 128
    )
      throw new BadRequestException({ code: 'CASH_PAYMENT_REQUEST_INVALID' });
    return {
      data: await this.payments.record(request.staffPrincipal, {
        ...body.data,
        tableSessionId: sessionId,
        idempotencyKey: key.trim(),
      }),
    };
  }
}
