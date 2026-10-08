import { type Job, UnrecoverableError } from 'bullmq';
import { z } from 'zod';
import { defineJob, type JobContext, type JobEnvelope } from '../../common/queue/job-definition';
import type { JobProcessor } from '../../common/queue/job-processor';
import { NonRetryableJobError } from '../../common/queue/retry-policy';
import { JobDispatcher } from './job-dispatcher';

const ORDER_JOB = defineJob({
  queue: 'payment',
  name: 'test.order',
  payload: z.object({ orderId: z.string() }),
  retry: { maxAttempts: 3, delaysMs: [100, 200], jitterRatio: 0 },
});

function processor(run: (payload: { orderId: string }, ctx: JobContext) => Promise<void>) {
  return { job: ORDER_JOB, process: jest.fn(run) } satisfies JobProcessor<{ orderId: string }>;
}

function bullJob(name: string, data: unknown, attemptsMade = 0): Job<JobEnvelope> {
  return { id: 'job-1', name, data, attemptsMade } as unknown as Job<JobEnvelope>;
}

describe('JobDispatcher', () => {
  it('routes a job by name with its payload and context', async () => {
    const p = processor(async () => undefined);
    const dispatcher = new JobDispatcher([p]);
    await dispatcher.dispatch(
      bullJob('test.order', { payload: { orderId: 'o-1' }, correlationId: 'req-1' }, 1),
    );
    expect(p.process).toHaveBeenCalledWith(
      { orderId: 'o-1' },
      { jobId: 'job-1', queue: 'payment', attempt: 2, correlationId: 'req-1' },
    );
  });

  it('fails a job without a processor permanently', async () => {
    const dispatcher = new JobDispatcher([]);
    await expect(dispatcher.dispatch(bullJob('unknown', {}))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });

  it('turns NonRetryableJobError and invalid payloads into permanent failures', async () => {
    const dispatcher = new JobDispatcher([
      processor(async () => {
        throw new NonRetryableJobError('order is gone');
      }),
    ]);
    await expect(
      dispatcher.dispatch(bullJob('test.order', { payload: { orderId: 'o-1' } })),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(
      dispatcher.dispatch(bullJob('test.order', { payload: { orderId: 7 } })),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('lets other errors through so the retry policy applies', async () => {
    const failure = new Error('database unavailable');
    const dispatcher = new JobDispatcher([processor(() => Promise.reject(failure))]);
    await expect(
      dispatcher.dispatch(bullJob('test.order', { payload: { orderId: 'o-1' } })),
    ).rejects.toBe(failure);
  });

  it('uses the job retry policy for backoff', () => {
    const dispatcher = new JobDispatcher([processor(async () => undefined)]);
    expect(dispatcher.retryDelay(1, 'test.order')).toBe(100);
    expect(dispatcher.retryDelay(2, 'test.order')).toBe(200);
  });

  it('refuses two processors for one job name', () => {
    const p = processor(async () => undefined);
    expect(() => new JobDispatcher([p, p])).toThrow(/Duplicate processor/);
  });
});
