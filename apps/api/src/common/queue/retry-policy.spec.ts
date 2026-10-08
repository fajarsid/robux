import { DEFAULT_RETRY_POLICY, retryDelayMs, type RetryPolicy } from './retry-policy';

describe('retryDelayMs', () => {
  const noJitter = () => 0.5;

  it('follows the 5s, 15s, 30s, 60s, 5m schedule', () => {
    const delays = [1, 2, 3, 4, 5].map((n) => retryDelayMs(DEFAULT_RETRY_POLICY, n, noJitter));
    expect(delays).toEqual([5_000, 15_000, 30_000, 60_000, 300_000]);
  });

  it('bounds retries: at most five runs in total', () => {
    expect(DEFAULT_RETRY_POLICY.maxAttempts).toBe(5);
  });

  it('repeats the last delay when attempts outlast the schedule', () => {
    const policy: RetryPolicy = { maxAttempts: 10, delaysMs: [100, 200], jitterRatio: 0 };
    expect(retryDelayMs(policy, 7)).toBe(200);
  });

  it('spreads delays by at most the jitter ratio', () => {
    expect(retryDelayMs(DEFAULT_RETRY_POLICY, 1, () => 0)).toBe(4_000);
    expect(retryDelayMs(DEFAULT_RETRY_POLICY, 1, () => 1)).toBe(6_000);
  });

  it('never returns a negative delay', () => {
    const policy: RetryPolicy = { maxAttempts: 2, delaysMs: [10], jitterRatio: 5 };
    expect(retryDelayMs(policy, 1, () => 0)).toBe(0);
  });
});
