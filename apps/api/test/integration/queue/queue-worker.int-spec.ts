import { z } from 'zod';
import type { AppConfig } from '../../../src/config/app-config';
import { BullMqQueuePublisher } from '../../../src/common/queue/bullmq-queue.publisher';
import { BullMqQueueRegistry } from '../../../src/common/queue/bullmq-queue.registry';
import { defineJob, type JobContext } from '../../../src/common/queue/job-definition';
import type { JobProcessor } from '../../../src/common/queue/job-processor';
import { NonRetryableJobError, type RetryPolicy } from '../../../src/common/queue/retry-policy';
import { JobDispatcher } from '../../../src/processes/worker/job-dispatcher';
import { QueueConsumerHost } from '../../../src/processes/worker/queue-consumer.host';
import {
  testProcessConfig,
  testRedisAdmin,
  uniqueQueuePrefix,
  waitFor,
} from '../support/test-queue';

const FAST_RETRY: RetryPolicy = { maxAttempts: 3, delaysMs: [20, 40], jitterRatio: 0 };
const TEST_JOB = defineJob({
  queue: 'payment',
  name: 'test.entity-touch',
  payload: z.object({ entityId: z.string() }),
  retry: FAST_RETRY,
});
type Payload = { entityId: string };

interface Harness {
  config: AppConfig;
  registry: BullMqQueueRegistry;
  publisher: BullMqQueuePublisher;
  host: QueueConsumerHost;
  runs: Array<{ payload: Payload; context: JobContext }>;
}

const open: Harness[] = [];

function harness(
  run: (payload: Payload, context: JobContext) => Promise<void>,
  config = testProcessConfig('worker'),
): Harness {
  const runs: Harness['runs'] = [];
  const processor: JobProcessor<Payload> = {
    job: TEST_JOB,
    process: async (payload, context) => {
      runs.push({ payload, context });
      await run(payload, context);
    },
  };
  const registry = new BullMqQueueRegistry(config);
  const h: Harness = {
    config,
    registry,
    publisher: new BullMqQueuePublisher(registry),
    host: new QueueConsumerHost(config, new JobDispatcher([processor])),
    runs,
  };
  open.push(h);
  return h;
}

afterEach(async () => {
  for (const h of open.splice(0)) {
    await h.host.onModuleDestroy();
    await h.registry.onModuleDestroy();
  }
});

describe('BullMQ queue and worker', () => {
  it('delivers a published job to its processor with job context', async () => {
    const h = harness(async () => undefined);
    h.host.onApplicationBootstrap();
    await h.publisher.publish(TEST_JOB, { entityId: 'e-1' }, { correlationId: 'req-123' });

    await waitFor(async () => h.runs.length === 1);
    expect(h.runs[0]).toMatchObject({
      payload: { entityId: 'e-1' },
      context: { queue: 'payment', attempt: 1, correlationId: 'req-123' },
    });
    await expect(h.host.check()).resolves.toBeUndefined();
  });

  it('ignores a second publish with the same job id', async () => {
    const h = harness(async () => undefined);
    await h.publisher.publish(TEST_JOB, { entityId: 'e-1' }, { jobId: 'evt-1' });
    await h.publisher.publish(TEST_JOB, { entityId: 'e-1' }, { jobId: 'evt-1' });
    expect(await h.registry.get('payment').getJobCounts('wait')).toEqual({ wait: 1 });

    h.host.onApplicationBootstrap();
    await waitFor(async () => h.runs.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(h.runs).toHaveLength(1);
  });

  it('retries a failing job with backoff and completes once it succeeds', async () => {
    let failuresLeft = 1;
    const h = harness(async () => {
      if (failuresLeft-- > 0) {
        throw new Error('transient');
      }
    });
    h.host.onApplicationBootstrap();
    await h.publisher.publish(TEST_JOB, { entityId: 'e-1' }, { jobId: 'retry-1' });

    await waitFor(
      async () => (await h.registry.get('payment').getJobState('retry-1')) === 'completed',
    );
    expect(h.runs.map((r) => r.context.attempt)).toEqual([1, 2]);
  });

  it('stops after the bounded number of attempts and keeps the failed job inspectable', async () => {
    const h = harness(async () => {
      throw new Error('provider unavailable');
    });
    h.host.onApplicationBootstrap();
    await h.publisher.publish(
      TEST_JOB,
      { entityId: 'e-9' },
      { jobId: 'exhaust-1', correlationId: 'req-9' },
    );

    const queue = h.registry.get('payment');
    await waitFor(async () => (await queue.getJobState('exhaust-1')) === 'failed');
    expect(h.runs).toHaveLength(FAST_RETRY.maxAttempts);
    const failed = await queue.getJob('exhaust-1');
    expect(failed).toMatchObject({
      id: 'exhaust-1',
      name: 'test.entity-touch',
      queueName: 'payment',
      attemptsMade: 3,
      failedReason: 'provider unavailable',
      data: { payload: { entityId: 'e-9' }, correlationId: 'req-9' },
    });
    expect(failed?.timestamp).toEqual(expect.any(Number));
    expect(failed?.finishedOn).toEqual(expect.any(Number));
  });

  it('fails a non-retryable error on the first attempt', async () => {
    const h = harness(async () => {
      throw new NonRetryableJobError('entity no longer eligible');
    });
    h.host.onApplicationBootstrap();
    await h.publisher.publish(TEST_JOB, { entityId: 'e-1' }, { jobId: 'final-1' });

    const queue = h.registry.get('payment');
    await waitFor(async () => (await queue.getJobState('final-1')) === 'failed');
    expect(h.runs).toHaveLength(1);
    expect((await queue.getJob('final-1'))?.failedReason).toBe('entity no longer eligible');
  });

  it('refuses to publish credential-like payload keys', async () => {
    const h = harness(async () => undefined);
    const leaky = defineJob({
      queue: 'payment',
      name: 'test.leaky',
      payload: z.object({ sessionToken: z.string() }),
    });
    await expect(h.publisher.publish(leaky, { sessionToken: 'secret' })).rejects.toThrow(
      /not allowed/,
    );
    expect(await h.registry.get('payment').getJobCounts('wait')).toEqual({ wait: 0 });
  });

  it('lets the active job finish on shutdown and takes no new jobs', async () => {
    let release!: () => void;
    const h = harness(() => new Promise<void>((resolve) => (release = resolve)));
    h.host.onApplicationBootstrap();
    await h.publisher.publish(TEST_JOB, { entityId: 'e-1' }, { jobId: 'active-1' });
    await waitFor(async () => h.runs.length === 1);
    await h.publisher.publish(TEST_JOB, { entityId: 'e-2' }, { jobId: 'queued-1' });

    const shutdown = h.host.onModuleDestroy();
    setTimeout(() => release(), 200);
    await shutdown;

    const queue = h.registry.get('payment');
    expect(await queue.getJobState('active-1')).toBe('completed');
    expect(await queue.getJobState('queued-1')).toBe('waiting');
    expect(h.runs).toHaveLength(1);
  });

  it('force-closes after the shutdown timeout instead of hanging', async () => {
    const config = testProcessConfig('worker', { WORKER_SHUTDOWN_TIMEOUT_MS: '1000' });
    const h = harness(() => new Promise<void>(() => undefined), config);
    h.host.onApplicationBootstrap();
    await h.publisher.publish(TEST_JOB, { entityId: 'e-1' }, { jobId: 'stuck-1' });
    await waitFor(async () => h.runs.length === 1);

    const started = Date.now();
    await h.host.onModuleDestroy();
    expect(Date.now() - started).toBeLessThan(5_000);
    // The job keeps its lock and is re-delivered by stalled-job recovery, never completed silently.
    expect(await h.registry.get('payment').getJobState('stuck-1')).toBe('active');
  });

  it('keeps consuming after Redis drops its connections', async () => {
    const h = harness(async () => undefined);
    h.host.onApplicationBootstrap();
    await h.publisher.publish(TEST_JOB, { entityId: 'before' });
    await waitFor(async () => h.runs.length === 1);

    const admin = testRedisAdmin();
    try {
      await admin.client('KILL', 'TYPE', 'normal', 'SKIPME', 'yes');
    } finally {
      admin.disconnect();
    }

    await waitFor(async () => {
      try {
        await h.publisher.publish(TEST_JOB, { entityId: 'after' }, { jobId: 'after-reconnect' });
        return true;
      } catch {
        return false;
      }
    });
    await waitFor(async () => h.runs.some((r) => r.payload.entityId === 'after'));
  });

  it('does not consume jobs of another queue prefix (environment isolation)', async () => {
    const other = harness(async () => undefined);
    const config = testProcessConfig('worker', { QUEUE_PREFIX: uniqueQueuePrefix() });
    const h = harness(async () => undefined, config);
    h.host.onApplicationBootstrap();

    await other.publisher.publish(TEST_JOB, { entityId: 'foreign' }, { jobId: 'foreign-1' });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(h.runs).toHaveLength(0);
    expect(await other.registry.get('payment').getJobState('foreign-1')).toBe('waiting');
  });
});

describe('Redis access control', () => {
  it('rejects a publisher with the wrong password', async () => {
    const config = testProcessConfig('worker', { REDIS_PASSWORD: 'wrong-password' });
    const registry = new BullMqQueueRegistry(config);
    try {
      await expect(
        new BullMqQueuePublisher(registry).publish(TEST_JOB, { entityId: 'e-1' }),
      ).rejects.toThrow();
    } finally {
      await registry.onModuleDestroy();
    }
  });

  it('fails fast when Redis is unreachable', async () => {
    const config = testProcessConfig('worker', { REDIS_HOST: '127.0.0.1', REDIS_PORT: '1' });
    const registry = new BullMqQueueRegistry(config);
    const started = Date.now();
    try {
      await expect(
        new BullMqQueuePublisher(registry).publish(TEST_JOB, { entityId: 'e-1' }),
      ).rejects.toThrow(/timed out/);
      await expect(registry.ping('payment')).rejects.toThrow(/timed out/);
      // Bounded by the producer timeout instead of waiting for Redis indefinitely.
      expect(Date.now() - started).toBeLessThan(12_000);
    } finally {
      await registry.onModuleDestroy();
    }
  });
});
