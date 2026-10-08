import type { FulfillmentConfig } from '../../../config/fulfillment-config';
import { OrderEvent } from '../../orders/domain/order-events';
import { FULFILLMENT_REQUESTED_JOB } from '../../../processes/jobs/fulfillment-requested.job';
import { ORDER_PAYMENT_CONFIRMED_JOB } from '../../../processes/jobs/order-payment-confirmed.job';
import { TELEGRAM_ORDER_NOTIFICATION_JOB } from '../../../processes/jobs/telegram-order-notification.job';
import type { OutboxRoute } from './outbox-routes';

/**
 * Event types the relay delivers, each to the job that consumes it. Every other event type
 * (ORDER_CREATED, ORDER_CANCELLED, ORDER_EXPIRED, PAYMENT_RECONCILIATION_REQUIRED, the
 * FULFILLMENT_* progress events, ...) stays unpublished in `outbox_events` until the phase that
 * builds its consumer adds a route here; the relay then delivers the backlog.
 */
export const OUTBOX_ROUTE_TABLE: readonly OutboxRoute[] = [
  { eventType: OrderEvent.PAYMENT_CONFIRMED, job: ORDER_PAYMENT_CONFIRMED_JOB },
  { eventType: OrderEvent.PAYMENT_CONFIRMED, job: TELEGRAM_ORDER_NOTIFICATION_JOB },
  { eventType: OrderEvent.FULFILLMENT_COMPLETED, job: TELEGRAM_ORDER_NOTIFICATION_JOB },
];

/**
 * FULFILLMENT_REQUESTED is routed only when a fulfillment provider is configured. With
 * FULFILLMENT_PROVIDER=none (production until an authorized provider exists) QUEUED orders wait
 * with their request unpublished, and are delivered as a backlog once a provider is enabled,
 * instead of failing against no provider.
 */
export function outboxRoutesFor(fulfillment: FulfillmentConfig): readonly OutboxRoute[] {
  return fulfillment.provider === 'none'
    ? OUTBOX_ROUTE_TABLE
    : [
        ...OUTBOX_ROUTE_TABLE,
        { eventType: OrderEvent.FULFILLMENT_REQUESTED, job: FULFILLMENT_REQUESTED_JOB },
      ];
}
