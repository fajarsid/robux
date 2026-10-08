import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  type CreatePaymentRequest,
  createPaymentRequestSchema,
  type PaymentView,
} from '@robux/shared';
import type { Request, Response } from 'express';
import { requestContextOf } from '../../../common/http/request-context';
import { RateLimit } from '../../../common/rate-limit/rate-limit.decorator';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe';
import type { AuthenticatedPrincipal } from '../../auth/domain/authenticated-principal';
import { Permission } from '../../auth/domain/permissions';
import { CurrentPrincipal, RequirePermissions } from '../../auth/http/auth-decorators';
import { CreatePaymentService } from '../application/create-payment.service';
import { PaymentQueriesService } from '../application/payment-queries.service';
import { sendPaymentCreation } from './payment-creation.response';

/** Payment of a signed-in customer's own order; another customer's order is a 404. */
@Controller('me/orders/:id/payment')
@RequirePermissions(Permission.CUSTOMER_ORDERS_OWN)
export class CustomerPaymentsController {
  constructor(
    private readonly createPayment: CreatePaymentService,
    private readonly queries: PaymentQueriesService,
  ) {}

  @Post()
  @RateLimit(
    { name: 'payments-create:ip', scope: 'ip', limit: 20, windowSeconds: 600 },
    { name: 'payments-create:principal', scope: 'principal', limit: 30, windowSeconds: 3600 },
  )
  async create(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) orderId: string,
    @Body(new ZodValidationPipe(createPaymentRequestSchema)) body: CreatePaymentRequest,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PaymentView> {
    const result = await this.createPayment.create(
      { kind: 'customer', userId: principal.userId, orderId },
      body,
      idempotencyKey,
      requestContextOf(req),
    );
    return sendPaymentCreation(res, result);
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  latest(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) orderId: string,
  ): Promise<PaymentView> {
    return this.queries.latestForOrder({ kind: 'customer', userId: principal.userId, orderId });
  }
}
