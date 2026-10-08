import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { type AdminOrderView, cancelOrderRequestSchema } from '@robux/shared';
import type { Request } from 'express';
import { requestContextOf } from '../../../common/http/request-context';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe';
import type { AuthenticatedPrincipal } from '../../auth/domain/authenticated-principal';
import { Permission } from '../../auth/domain/permissions';
import { CurrentPrincipal, RequirePermissions } from '../../auth/http/auth-decorators';
import { CancelOrderService } from '../application/cancel-order.service';
import { OrderQueriesService } from '../application/order-queries.service';

@Controller('admin/orders')
export class AdminOrdersController {
  constructor(
    private readonly queries: OrderQueriesService,
    private readonly cancellation: CancelOrderService,
  ) {}

  @Get(':id')
  @RequirePermissions(Permission.ORDERS_READ_ANY)
  detail(@Param('id', new ParseUUIDPipe()) orderId: string): Promise<AdminOrderView> {
    return this.queries.getForStaff(orderId);
  }

  /** ADMIN and SUPER_ADMIN only (orders.cancel); OPERATOR is denied by owner decision. */
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.ORDERS_CANCEL)
  async cancel(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) orderId: string,
    @Body(new ZodValidationPipe(cancelOrderRequestSchema)) body: { reason: string },
    @Req() req: Request,
  ): Promise<AdminOrderView> {
    await this.cancellation.cancelAsStaff(principal, orderId, body.reason, requestContextOf(req));
    return this.queries.getForStaff(orderId);
  }
}
