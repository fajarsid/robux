import { z } from 'zod';
import { defineJob } from '../../common/queue/job-definition';
import { NO_RETRY_POLICY } from '../../common/queue/retry-policy';

/**
 * Probes ACTIVE sources whose health keeps them out of routing. Repeats every minute, so a failed
 * run is not retried: the next run is the retry.
 */
export const SOURCE_HEALTH_CHECK_JOB = defineJob({
  queue: 'inventory-sync',
  name: 'inventory.source-health-check',
  payload: z.object({}).strict(),
  retry: NO_RETRY_POLICY,
});

export const SOURCE_HEALTH_CHECK_INTERVAL_MS = 60_000;
