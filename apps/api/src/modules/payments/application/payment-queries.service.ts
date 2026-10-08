import { Inject, Injectable } from '@nestjs/common';
import { ErrorCode, type PaymentMethodsView, type PaymentView } from '@robux/shared';
import { DomainError } from '../../../common/errors/domain-error';
import { PayableOrderService } from '../../orders/application/payable-order.service';
import {
  gatewayForMethod,
  PAYMENT_GATEWAY,
  type PaymentGatewayResolver,
} from '../domain/payment-gateway';
import { PAYMENT_REPOSITORY, type PaymentRepository } from '../domain/payment.repository';
import { type PaymentOrderAccess, resolvePayableOrder } from './payment-order-access';
import { toPaymentView } from './payment-views';

/**
 * Read side for customers. Reads only our database: the gateway is asked for status only when it
 * calls us (or by reconciliation), never because someone opened a page.
 */
@Injectable()
export class PaymentQueriesService {
  constructor(
    private readonly orders: PayableOrderService,
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGatewayResolver | null,
  ) {}

  enabledMethods(channel: 'customer' | 'telegram' = 'customer'): PaymentMethodsView {
    const methods = this.gateway?.enabledMethods() ?? [];
    return {
      methods: methods
        .filter(
          (code) =>
            channel === 'telegram' || !gatewayForMethod(this.gateway, code)?.requiresTelegramChat,
        )
        .map((code) => ({ code })),
    };
  }

  async latestForOrder(access: PaymentOrderAccess, now = new Date()): Promise<PaymentView> {
    const order = await resolvePayableOrder(this.orders, access);
    const payment = await this.payments.latestForOrder(order.id);
    if (!payment) {
      throw new DomainError(ErrorCode.PAYMENT_NOT_FOUND, 'Belum ada pembayaran untuk pesanan ini.');
    }
    return toPaymentView(payment, now);
  }
}
