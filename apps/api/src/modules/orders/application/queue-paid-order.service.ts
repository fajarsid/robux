import { Inject, Injectable } from '@nestjs/common';
import { OrderEvent } from '../domain/order-events';
import { hasEnteredFulfillment } from '../domain/order-state-machine';
import {
  ORDER_STATUS_TRANSITION_REPOSITORY,
  type OrderStatusTransitionRepository,
} from '../domain/order-status-transition.repository';

/**
 * QUEUED: this run moved the order PAID → QUEUED.
 * ALREADY_QUEUED: an earlier delivery (or a concurrent one) already did; nothing to do.
 * NOT_ELIGIBLE: the order left PAID another way (refund, reconciliation); the event is obsolete.
 * ORDER_NOT_FOUND: the event names an order that does not exist.
 */
export type QueuePaidOrderOutcome =
  'QUEUED' | 'ALREADY_QUEUED' | 'NOT_ELIGIBLE' | 'ORDER_NOT_FOUND';

/**
 * Hands a paid order to fulfillment (ARCHITECTURE.md §6.8, order-processing). Safe to run any
 * number of times for the same order: the PAID → QUEUED transition is conditional, so exactly one
 * run changes state and writes the FULFILLMENT_REQUESTED outbox event in the same transaction.
 */
@Injectable()
export class QueuePaidOrderService {
  constructor(
    @Inject(ORDER_STATUS_TRANSITION_REPOSITORY)
    private readonly orders: OrderStatusTransitionRepository,
  ) {}

  async queue(
    orderId: string,
    trigger: { outboxEventId: string; requestId?: string },
  ): Promise<QueuePaidOrderOutcome> {
    const order = await this.orders.findState(orderId);
    if (!order) {
      return 'ORDER_NOT_FOUND';
    }
    if (order.status === 'PAID') {
      const result = await this.orders.apply({
        orderId,
        from: 'PAID',
        to: 'QUEUED',
        actorType: 'SYSTEM',
        reason: 'Pembayaran terkonfirmasi; diteruskan ke pengiriman',
        metadata: { outboxEventId: trigger.outboxEventId },
        requestId: trigger.requestId,
        outboxEventType: OrderEvent.FULFILLMENT_REQUESTED,
      });
      if (result.applied) {
        return 'QUEUED';
      }
    }
    // Either not PAID to begin with, or a concurrent run won the conditional update.
    const current = order.status === 'PAID' ? await this.orders.findState(orderId) : order;
    return current && hasEnteredFulfillment(current.status) ? 'ALREADY_QUEUED' : 'NOT_ELIGIBLE';
  }
}
