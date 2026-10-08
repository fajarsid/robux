export interface RetryPolicy {
  /** Total runs including the first one. 1 means "never retry". */
  maxAttempts: number;
  /** Delay before retry n is `delaysMs[n - 1]`; the last value repeats if attempts outlast the list. */
  delaysMs: readonly number[];
  /** Random spread of ±ratio around each delay, so failed jobs do not retry in lockstep. */
  jitterRatio: number;
}

/** ARCHITECTURE.md §6.6: 5 s, 15 s, 30 s, 60 s, 5 min, at most 5 runs. */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 5,
  delaysMs: [5_000, 15_000, 30_000, 60_000, 300_000],
  jitterRatio: 0.2,
};

export const NO_RETRY_POLICY: RetryPolicy = { maxAttempts: 1, delaysMs: [0], jitterRatio: 0 };

/** BullMQ backoff type that routes every retry through `retryDelayMs`. */
export const SCHEDULED_BACKOFF_TYPE = 'scheduled';

export function retryDelayMs(
  policy: RetryPolicy,
  attemptsMade: number,
  random: () => number = Math.random,
): number {
  const index = Math.min(Math.max(attemptsMade, 1), policy.delaysMs.length) - 1;
  const base = policy.delaysMs[index] ?? 0;
  const spread = base * policy.jitterRatio * (random() * 2 - 1);
  return Math.max(0, Math.round(base + spread));
}

/**
 * Thrown by a processor when running the job again cannot succeed (invalid payload, entity in a
 * state the job does not apply to). The job fails immediately instead of exhausting retries.
 */
export class NonRetryableJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableJobError';
  }
}
