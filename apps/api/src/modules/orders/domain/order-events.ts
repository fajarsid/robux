/**
 * Outbox event types announced about an order (aggregate `order`). One place for the names that
 * producers write and the outbox route table and consumers match on.
 */
export const OrderEvent = {
  /** Payment verified and the order moved to PAID (payments, Phase 6). */
  PAYMENT_CONFIRMED: 'PAYMENT_CONFIRMED',
  /** Order handed to fulfillment (QUEUED). Consumed by the fulfillment engine from Phase 9. */
  FULFILLMENT_REQUESTED: 'FULFILLMENT_REQUESTED',
  /**
   * Fulfillment engine (Phase 9), one per order transition it makes. Not routed: they wait in the
   * outbox for the notification and monitoring consumers of later phases.
   */
  FULFILLMENT_STARTED: 'FULFILLMENT_STARTED',
  FULFILLMENT_PENDING: 'FULFILLMENT_PENDING',
  FULFILLMENT_PARTIAL: 'FULFILLMENT_PARTIAL',
  FULFILLMENT_FAILED: 'FULFILLMENT_FAILED',
  FULFILLMENT_RETRYING: 'FULFILLMENT_RETRYING',
  FULFILLMENT_PERMANENTLY_FAILED: 'FULFILLMENT_PERMANENTLY_FAILED',
  FULFILLMENT_COMPLETED: 'FULFILLMENT_COMPLETED',
  FULFILLMENT_RECONCILIATION_REQUIRED: 'FULFILLMENT_RECONCILIATION_REQUIRED',
} as const;

export const ORDER_AGGREGATE = 'order';
