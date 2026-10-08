import { defineJob } from '../../common/queue/job-definition';
import { OUTBOX_EVENT_JOB_PAYLOAD } from '../../modules/outbox/application/outbox-routes';

/**
 * Delivered by the outbox relay for every PAYMENT_CONFIRMED event. Moves the paid order to QUEUED
 * and requests fulfillment. Uses the queue's default retry policy (5 s … 5 min, 5 runs).
 */
export const ORDER_PAYMENT_CONFIRMED_JOB = defineJob({
  queue: 'order-processing',
  name: 'order.payment-confirmed',
  payload: OUTBOX_EVENT_JOB_PAYLOAD,
});
