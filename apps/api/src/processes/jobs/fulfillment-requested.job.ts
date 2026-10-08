import { defineJob } from '../../common/queue/job-definition';
import { OUTBOX_EVENT_JOB_PAYLOAD } from '../../modules/outbox/application/outbox-routes';

/**
 * Delivered by the outbox relay for every FULFILLMENT_REQUESTED event. Each run advances the
 * order's fulfillment by one step; the queue's retry policy (5 s, 15 s, 30 s, 60 s, 5 min; 5 runs)
 * is also the fulfillment retry and verification schedule (ARCHITECTURE.md §6.6).
 */
export const FULFILLMENT_REQUESTED_JOB = defineJob({
  queue: 'fulfillment',
  name: 'fulfillment.requested',
  payload: OUTBOX_EVENT_JOB_PAYLOAD,
});
