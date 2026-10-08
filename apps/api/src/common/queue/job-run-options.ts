import type { JobsOptions } from 'bullmq';
import type { JobDefinition, JobPayload } from './job-definition';
import { JOB_RETENTION, QUEUE_SETTINGS } from './queue-catalog';
import { SCHEDULED_BACKOFF_TYPE, type RetryPolicy } from './retry-policy';

export function retryPolicyFor(job: JobDefinition<JobPayload>): RetryPolicy {
  return job.retry ?? QUEUE_SETTINGS[job.queue].retry;
}

/** Attempts, backoff and retention applied to every job, whether published or scheduled. */
export function jobRunOptions(job: JobDefinition<JobPayload>): JobsOptions {
  return {
    attempts: retryPolicyFor(job).maxAttempts,
    backoff: { type: SCHEDULED_BACKOFF_TYPE },
    ...JOB_RETENTION,
  };
}
