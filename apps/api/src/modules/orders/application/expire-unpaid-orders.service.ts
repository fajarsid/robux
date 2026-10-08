import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ORDER_STATUS_TRANSITION_REPOSITORY,
  type OrderStatusTransitionRepository,
} from '../domain/order-status-transition.repository';

const BATCH_SIZE = 100;

/**
 * Cancels PAYMENT_PENDING orders whose payment deadline has passed. Idempotent and safe to run
 * from several processes at once: each transition is conditional on the order still being
 * PAYMENT_PENDING, so a payment arriving at the same moment wins or loses cleanly.
 */
@Injectable()
export class ExpireUnpaidOrdersService {
  private readonly logger = new Logger(ExpireUnpaidOrdersService.name);

  constructor(
    @Inject(ORDER_STATUS_TRANSITION_REPOSITORY)
    private readonly orders: OrderStatusTransitionRepository,
  ) {}

  async expireDue(now = new Date()): Promise<number> {
    let expired = 0;
    for (const order of await this.orders.dueForPaymentExpiry(now, BATCH_SIZE)) {
      const result = await this.orders.apply({
        orderId: order.id,
        from: 'PAYMENT_PENDING',
        to: 'CANCELLED',
        actorType: 'SCHEDULER',
        cancelReason: 'PAYMENT_EXPIRED',
        reason: 'Batas waktu pembayaran terlewati',
        outboxEventType: 'ORDER_EXPIRED',
      });
      if (result.applied) {
        expired += 1;
      }
    }
    if (expired > 0) {
      this.logger.log({ event: 'orders.payment_expired', count: expired });
    }
    return expired;
  }
}
