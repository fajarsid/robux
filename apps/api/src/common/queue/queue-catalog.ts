import { DEFAULT_RETRY_POLICY, type RetryPolicy } from './retry-policy';

/**
 * Queues that exist today (ARCHITECTURE.md §6.8). A queue is added here together with its first
 * job, never ahead of it.
 */
export type QueueName = 'payment' | 'order-processing' | 'fulfillment' | 'inventory-sync';

export interface QueueSettings {
  retry: RetryPolicy;
  /** Jobs processed in parallel by one worker process. */
  concurrency: number;
}

export const QUEUE_SETTINGS: Readonly<Record<QueueName, QueueSettings>> = {
  payment: { retry: DEFAULT_RETRY_POLICY, concurrency: 1 },
  // Each job touches one order with a conditional update, so jobs for different orders run in parallel.
  'order-processing': { retry: DEFAULT_RETRY_POLICY, concurrency: 5 },
  // One workflow per order is guarded by its lease in PostgreSQL; different orders run in parallel.
  fulfillment: { retry: DEFAULT_RETRY_POLICY, concurrency: 5 },
  'inventory-sync': { retry: DEFAULT_RETRY_POLICY, concurrency: 1 },
};

export const QUEUE_NAMES = Object.keys(QUEUE_SETTINGS) as QueueName[];

/**
 * Completed jobs are kept briefly for inspection; failed jobs long enough to investigate. A job id
 * is only deduplicated by BullMQ while its record exists, which is why business idempotency stays
 * in PostgreSQL.
 */
export const JOB_RETENTION = {
  removeOnComplete: { age: 60 * 60, count: 1_000 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 5_000 },
} as const;
