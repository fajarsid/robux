import type { JobContext, JobDefinition, JobPayload } from './job-definition';

/**
 * Consumer side of one job. A processor loads current state from PostgreSQL and calls a use case;
 * it must tolerate running more than once for the same payload (redelivery after a crash, a
 * re-published outbox event, an operator retry). Throw `NonRetryableJobError` when retrying
 * cannot help; any other error is retried by the job's retry policy.
 */
export interface JobProcessor<P extends JobPayload = JobPayload> {
  readonly job: JobDefinition<P>;
  process(payload: P, context: JobContext): Promise<void>;
}

export const JOB_PROCESSORS = Symbol('JOB_PROCESSORS');
