import type { z } from 'zod';
import type { QueueName } from './queue-catalog';
import type { RetryPolicy } from './retry-policy';

/**
 * Job payloads are flat records of identifiers and scalars. Processors load authoritative state
 * from PostgreSQL, so a payload never needs (and must never carry) secrets or nested documents.
 */
export type JobPayload = Readonly<Record<string, string | number | boolean | null>>;

export interface JobDefinition<P extends JobPayload = JobPayload> {
  readonly queue: QueueName;
  /** Stable, domain-oriented name (`payment.expiry-sweep`); part of the Redis job record. */
  readonly name: string;
  readonly payload: z.ZodType<P>;
  /** Overrides the queue's default retry policy for this job. */
  readonly retry?: RetryPolicy;
}

export type PayloadOf<J> = J extends JobDefinition<infer P> ? P : never;

/** What is stored as BullMQ job data. Correlation travels with the job for log tracing. */
export interface JobEnvelope<P extends JobPayload = JobPayload> {
  payload: P;
  correlationId: string | null;
}

export interface JobContext {
  jobId: string;
  queue: QueueName;
  /** 1-based attempt number of the current run. */
  attempt: number;
  correlationId: string | null;
}

export function defineJob<P extends JobPayload>(definition: JobDefinition<P>): JobDefinition<P> {
  return definition;
}
