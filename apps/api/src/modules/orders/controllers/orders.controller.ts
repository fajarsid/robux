import { Body, Controller, Headers, Post, Req, Res } from '@nestjs/common';
import {
  type CreateOrderRequest,
  createOrderRequestSchema,
  type OrderCreatedView,
} from '@robux/shared';
import type { Response } from 'express';
import { requestContextOf } from '../../../common/http/request-context';
import { RateLimit } from '../../../common/rate-limit/rate-limit.decorator';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe';
import { Public } from '../../auth/http/auth-decorators';
import type { AuthenticatedRequest } from '../../auth/http/session-cookie';
import { CreateOrderService } from '../application/create-order.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly createOrder: CreateOrderService) {}

  /** Guests and signed-in customers. Totals come from the backend; the body carries no prices. */
  @Public()
  @Post()
  @RateLimit(
    { name: 'orders-create:ip', scope: 'ip', limit: 20, windowSeconds: 600 },
    { name: 'orders-create:principal', scope: 'principal', limit: 30, windowSeconds: 3600 },
  )
  async create(
    @Body(new ZodValidationPipe(createOrderRequestSchema)) body: CreateOrderRequest,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OrderCreatedView> {
    const result = await this.createOrder.create(
      body,
      idempotencyKey,
      req.principal,
      requestContextOf(req),
    );
    res.status(201);
    res.setHeader('Cache-Control', 'no-store');
    if (result.replayed) {
      res.setHeader('Idempotent-Replayed', 'true');
    }
    return result.order;
  }
}
