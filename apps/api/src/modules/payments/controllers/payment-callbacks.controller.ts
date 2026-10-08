import { Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { requestContextOf } from '../../../common/http/request-context';
import { RateLimit } from '../../../common/rate-limit/rate-limit.decorator';
import { Public, SkipCsrf } from '../../auth/http/auth-decorators';
import { ProcessPaymentCallbackService } from '../application/process-payment-callback.service';

/**
 * Server-to-server callbacks: no session, no CSRF token. Authenticity comes from the gateway
 * signature plus verify-by-fetch (SECURITY.md §5). Duitku redelivers anything but HTTP 200.
 */
@Controller('webhooks/payments')
export class PaymentCallbacksController {
  constructor(private readonly callbacks: ProcessPaymentCallbackService) {}

  @Public()
  @SkipCsrf()
  @Post('duitku')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ name: 'payment-callback:ip', scope: 'ip', limit: 300, windowSeconds: 60 })
  async duitku(@Req() req: Request): Promise<{ status: 'OK' }> {
    const context = requestContextOf(req);
    const body: unknown = req.body;
    await this.callbacks.handle(
      'DUITKU',
      {
        contentType: req.headers['content-type'],
        fields: body && typeof body === 'object' ? (body as Record<string, unknown>) : {},
        sourceIp: context.ipAddress,
      },
      context,
    );
    return { status: 'OK' };
  }
}
