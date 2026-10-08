import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { z } from 'zod';
import type { GuestOrderTrackingView } from '@robux/shared';
import type { Request } from 'express';
import { requestContextOf } from '../../../common/http/request-context';
import { RateLimit } from '../../../common/rate-limit/rate-limit.decorator';
import { Public } from '../../auth/http/auth-decorators';
import { CancelOrderService } from '../application/cancel-order.service';
import { OrderQueriesService } from '../application/order-queries.service';
import { DigitalAccountHandoffService } from '../application/digital-account-handoff.service';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe';

/** Access by the private tracking token only; never by order number or id (D-03). */
@Controller('track')
export class GuestOrderTrackingController {
  constructor(
    private readonly queries: OrderQueriesService,
    private readonly cancellation: CancelOrderService,
    private readonly handoff: DigitalAccountHandoffService,
  ) {}

  @Public()
  @Get(':token')
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @RateLimit({ name: 'track:ip', scope: 'ip', limit: 30, windowSeconds: 60 })
  track(@Param('token') token: string): Promise<GuestOrderTrackingView> {
    return this.queries.trackAsGuest(token);
  }

  @Public()
  @Post('handoff')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @RateLimit({ name: 'account-handoff:ip', scope: 'ip', limit: 5, windowSeconds: 600 })
  handoffAccount(
    @Body(new ZodValidationPipe(z.strictObject({ trackingToken: z.string().min(32).max(256) })))
    body: {
      trackingToken: string;
    },
  ) {
    return this.handoff.forGuest(body.trackingToken);
  }

  @Public()
  @Post(':token/cancel')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @RateLimit({ name: 'track-cancel:ip', scope: 'ip', limit: 10, windowSeconds: 600 })
  async cancel(
    @Param('token') token: string,
    @Req() req: Request,
  ): Promise<GuestOrderTrackingView> {
    await this.cancellation.cancelByTrackingToken(token, requestContextOf(req));
    return this.queries.trackAsGuest(token);
  }
}
