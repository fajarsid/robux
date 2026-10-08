import { defineJob } from '../../common/queue/job-definition';
import { OUTBOX_EVENT_JOB_PAYLOAD } from '../../modules/outbox/application/outbox-routes';

/** Delivers customer-safe order updates using identifiers only; the processor reads Core state. */
export const TELEGRAM_ORDER_NOTIFICATION_JOB = defineJob({
  queue: 'fulfillment',
  name: 'telegram.order-notification',
  payload: OUTBOX_EVENT_JOB_PAYLOAD,
});
