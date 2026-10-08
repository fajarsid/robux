import type { OrderTimelineEntry, PublicOrderStage } from '@robux/shared';
import type { OrderStatus } from '../../../generated/prisma/enums';

/**
 * Customers see a few stable stages, never internal states such as RETRYING or
 * RECONCILIATION_REQUIRED: from their side the order is simply still being processed.
 */
const STAGE_BY_STATUS: Readonly<Record<OrderStatus, PublicOrderStage>> = {
  CREATED: 'AWAITING_PAYMENT',
  PAYMENT_PENDING: 'AWAITING_PAYMENT',
  PAID: 'PROCESSING',
  QUEUED: 'PROCESSING',
  PROCESSING: 'PROCESSING',
  FULFILLMENT_PENDING: 'PROCESSING',
  FAILED: 'PROCESSING',
  RETRYING: 'PROCESSING',
  FAILED_PERMANENTLY: 'PROCESSING',
  PARTIALLY_FULFILLED: 'PROCESSING',
  RECONCILIATION_REQUIRED: 'PROCESSING',
  FULFILLED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  REFUND_PENDING: 'REFUND_IN_PROGRESS',
  REFUNDED: 'REFUNDED',
};

export function toPublicOrderStage(status: OrderStatus): PublicOrderStage {
  return STAGE_BY_STATUS[status];
}

/** One entry per stage reached, at the time it was first reached. */
export function toPublicTimeline(
  history: readonly { toStatus: OrderStatus; createdAt: Date }[],
): OrderTimelineEntry[] {
  const timeline: OrderTimelineEntry[] = [];
  for (const entry of history) {
    const stage = toPublicOrderStage(entry.toStatus);
    if (timeline[timeline.length - 1]?.stage !== stage) {
      timeline.push({ stage, at: entry.createdAt.toISOString() });
    }
  }
  return timeline;
}
