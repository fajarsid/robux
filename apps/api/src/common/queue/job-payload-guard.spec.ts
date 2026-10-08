import { z } from 'zod';
import { defineJob, type JobPayload } from './job-definition';
import { parseJobPayload } from './job-payload-guard';
import { NonRetryableJobError } from './retry-policy';

function jobWith<P extends JobPayload>(payload: z.ZodType<P>) {
  return defineJob({ queue: 'payment', name: 'test.job', payload });
}

describe('parseJobPayload', () => {
  it('accepts identifiers and drops keys the schema does not declare', () => {
    const job = jobWith(z.object({ orderId: z.string() }));
    expect(parseJobPayload(job, { orderId: 'o-1', extra: 'x' })).toEqual({ orderId: 'o-1' });
  });

  it('rejects payloads that fail the schema as non-retryable', () => {
    const job = jobWith(z.object({ orderId: z.uuid() }));
    expect(() => parseJobPayload(job, { orderId: 'not-a-uuid' })).toThrow(NonRetryableJobError);
  });

  it.each(['password', 'sessionToken', 'robloxCookie', 'apiKey', 'totpSecret', 'recoveryCode'])(
    'refuses a credential-like key (%s) even if a schema declares it',
    (key) => {
      const job = jobWith(z.object({ [key]: z.string() }) as z.ZodType<JobPayload>);
      expect(() => parseJobPayload(job, { [key]: 'value' })).toThrow(/not allowed/);
    },
  );

  it('refuses nested objects', () => {
    const job = jobWith(z.object({ order: z.any() }) as z.ZodType<JobPayload>);
    expect(() => parseJobPayload(job, { order: { id: 'o-1' } })).toThrow(/flat/);
  });
});
