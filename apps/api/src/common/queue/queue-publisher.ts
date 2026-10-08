import type { JobDefinition, JobPayload } from './job-definition';

export interface PublishOptions {
  /**
   * Deterministic id (e.g. the outbox event id). BullMQ ignores a second add with the same id while
   * the first job is retained; consumers must still be idempotent.
   */
  jobId?: string;
  correlationId?: string | null;
  delayMs?: number;
}

/** Application-facing port for enqueueing work. Callers never see BullMQ types. */
export interface QueuePublisher {
  publish<P extends JobPayload>(
    job: JobDefinition<P>,
    payload: P,
    options?: PublishOptions,
  ): Promise<void>;
}

export const QUEUE_PUBLISHER = Symbol('QUEUE_PUBLISHER');
