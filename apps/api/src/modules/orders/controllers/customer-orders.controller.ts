import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Header,
  Req,
} from '@nestjs/common';
import type { CustomerOrderDetailView, CustomerOrderSummaryView } from '@robux/shared';
import type { Request } from 'express';
import { requestContextOf } from '../../../common/http/request-context';
import { RateLimit } from '../../../common/rate-limit/rate-limit.decorator';
import type { AuthenticatedPrincipal } from '../../auth/domain/authenticated-principal';
import { Permission } from '../../auth/domain/permissions';
import { CurrentPrincipal, RequirePermissions } from '../../auth/http/auth-decorators';
import { CancelOrderService } from '../application/cancel-order.service';
import { OrderQueriesService } from '../application/order-queries.service';
import { DigitalAccountHandoffService } from '../application/digital-account-handoff.service';

@Controller('me/orders')
@RequirePermissions(Permission.CUSTOMER_ORDERS_OWN)
export class CustomerOrdersController {
  constructor(
    private readonly queries: OrderQueriesService,
    private readonly cancellation: CancelOrderService,
    private readonly handoff: DigitalAccountHandoffService,
  ) {}

  @Get()
  list(@CurrentPrincipal() principal: AuthenticatedPrincipal): Promise<CustomerOrderSummaryView[]> {
    return this.queries.listForCustomer(principal.userId);
  }

  @Get(':id')
  detail(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) orderId: string,
  ): Promise<CustomerOrderDetailView> {
    return this.queries.getForCustomer(principal.userId, orderId);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) orderId: string,
    @Req() req: Request,
  ): Promise<CustomerOrderDetailView> {
    await this.cancellation.cancelOwn(principal, orderId, requestContextOf(req));
    return this.queries.getForCustomer(principal.userId, orderId);
  }

  @Post(':id/handoff')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @RateLimit({ name: 'account-handoff:customer-ip', scope: 'ip', limit: 10, windowSeconds: 600 })
  handoffAccount(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) orderId: string,
  ) {
    return this.handoff.forCustomer(principal.userId, orderId);
  }
}
