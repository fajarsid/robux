import { z } from 'zod';
import { defineJob } from '../../common/queue/job-definition';
import { NO_RETRY_POLICY } from '../../common/queue/retry-policy';

/**
 * Cancels PAYMENT_PENDING orders past their payment deadline. Repeats every minute, so a failed
 * run is not retried: the next run is the retry.
 */
export const PAYMENT_EXPIRY_SWEEP_JOB = defineJob({
  queue: 'payment',
  name: 'payment.expiry-sweep',
  payload: z.object({}).strict(),
  retry: NO_RETRY_POLICY,
});

export const PAYMENT_EXPIRY_SWEEP_INTERVAL_MS = 60_000;
