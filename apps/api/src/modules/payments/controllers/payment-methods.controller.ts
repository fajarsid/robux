import { Controller, Get } from '@nestjs/common';
import type { PaymentMethodsView } from '@robux/shared';
import { Public } from '../../auth/http/auth-decorators';
import { PaymentQueriesService } from '../application/payment-queries.service';

@Controller('payments')
export class PaymentMethodsController {
  constructor(private readonly queries: PaymentQueriesService) {}

  /** Codes only; the storefront owns the labels. Empty when payment intake is switched off. */
  @Public()
  @Get('methods')
  methods(): PaymentMethodsView {
    return this.queries.enabledMethods();
  }
}
