import { Body, Controller, Get, Header, Headers, Param, Post, Req, Res } from '@nestjs/common';
import {
  type CreatePaymentRequest,
  createPaymentRequestSchema,
  type PaymentView,
} from '@robux/shared';
import type { Request, Response } from 'express';
import { requestContextOf } from '../../../common/http/request-context';
import { RateLimit } from '../../../common/rate-limit/rate-limit.decorator';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe';
import { Public } from '../../auth/http/auth-decorators';
import { CreatePaymentService } from '../application/create-payment.service';
import { PaymentQueriesService } from '../application/payment-queries.service';
import { sendPaymentCreation } from './payment-creation.response';

/** Payment by guest tracking token only, never by order number or id (D-03). */
@Controller('track/:token/payment')
export class GuestPaymentsController {
  constructor(
    private readonly createPayment: CreatePaymentService,
    private readonly queries: PaymentQueriesService,
  ) {}

  @Public()
  @Post()
  @Header('Referrer-Policy', 'no-referrer')
  @RateLimit({ name: 'track-payment-create:ip', scope: 'ip', limit: 20, windowSeconds: 600 })
  async create(
    @Param('token') token: string,
    @Body(new ZodValidationPipe(createPaymentRequestSchema)) body: CreatePaymentRequest,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PaymentView> {
    const result = await this.createPayment.create(
      { kind: 'guest', trackingToken: token },
      body,
      idempotencyKey,
      requestContextOf(req),
    );
    return sendPaymentCreation(res, result);
  }

  @Public()
  @Get()
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @RateLimit({ name: 'track-payment:ip', scope: 'ip', limit: 60, windowSeconds: 60 })
  latest(@Param('token') token: string): Promise<PaymentView> {
    return this.queries.latestForOrder({ kind: 'guest', trackingToken: token });
  }
}
