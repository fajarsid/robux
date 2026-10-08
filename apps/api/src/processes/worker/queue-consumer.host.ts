import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { type Job, Worker } from 'bullmq';
import type { AppConfig } from '../../config/app-config';
import { APP_CONFIG } from '../../config/app-config.module';
import type { ReadinessProbe } from '../../common/health/readiness-probe';
import { bullMqConnection } from '../../common/queue/bullmq-connection';
import type { JobEnvelope } from '../../common/queue/job-definition';
import { QUEUE_SETTINGS, type QueueName } from '../../common/queue/queue-catalog';
import { SCHEDULED_BACKOFF_TYPE } from '../../common/queue/retry-policy';
import { JobDispatcher } from './job-dispatcher';

/**
 * Runs one BullMQ worker per queue that has processors. On shutdown it pauses (no new jobs), lets
 * active jobs finish within the configured timeout, then closes without waiting further. A job cut
 * off that way stops renewing its lock, and BullMQ's stalled-job check re-delivers it.
 */
@Injectable()
export class QueueConsumerHost implements OnApplicationBootstrap, OnModuleDestroy, ReadinessProbe {
  readonly name = 'queue_consumers';
  private readonly logger = new Logger(QueueConsumerHost.name);
  private workers: Worker<JobEnvelope>[] = [];
  private shuttingDown = false;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly dispatcher: JobDispatcher,
  ) {}

  onApplicationBootstrap(): void {
    this.workers = this.dispatcher.queues().map((queue) => this.startWorker(queue));
    this.logger.log({
      event: 'worker.consumers_started',
      queues: this.workers.map((w) => w.name),
    });
  }

  async check(): Promise<void> {
    for (const worker of this.workers) {
      if (!worker.isRunning()) {
        throw new Error(`Worker for queue ${worker.name} is not running`);
      }
      const client = await worker.client;
      if (client.status !== 'ready') {
        throw new Error(`Worker for queue ${worker.name} is not connected`);
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;
    const workers = this.workers;
    this.workers = [];
    let timer: NodeJS.Timeout | undefined;
    const drained = Promise.all(workers.map((w) => w.pause())).then(() => true);
    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), this.config.queue.shutdownTimeoutMs);
    });
    const finished = await Promise.race([drained, timeout]);
    clearTimeout(timer);
    if (!finished) {
      this.logger.warn({
        event: 'worker.shutdown_timeout',
        timeoutMs: this.config.queue.shutdownTimeoutMs,
      });
    }
    // BullMQ reuses an in-flight close, so only one close call is made, after draining is decided.
    await Promise.all(workers.map((w) => w.close(true)));
    this.logger.log({ event: 'worker.consumers_stopped' });
  }

  private startWorker(queue: QueueName): Worker<JobEnvelope> {
    const worker = new Worker<JobEnvelope>(queue, (job) => this.dispatcher.dispatch(job), {
      connection: bullMqConnection(this.config, 'consumer', () => !this.shuttingDown),
      prefix: this.config.queue.prefix,
      concurrency: QUEUE_SETTINGS[queue].concurrency,
      settings: {
        backoffStrategy: (attemptsMade, type, _err, job) =>
          type === SCHEDULED_BACKOFF_TYPE && job
            ? this.dispatcher.retryDelay(attemptsMade, job.name)
            : 0,
      },
    });
    worker.on('completed', (job) =>
      this.logger.debug({ event: 'job.completed', ...jobFields(job) }),
    );
    worker.on('failed', (job, err) => this.logFailure(job, err));
    worker.on('stalled', (jobId) => this.logger.warn({ event: 'job.stalled', queue, jobId }));
    // Without a listener an emitted 'error' would crash the process.
    worker.on('error', (err) =>
      this.logger.warn({ event: 'queue.connection_error', queue, errorMessage: err.message }),
    );
    return worker;
  }

  private logFailure(job: Job<JobEnvelope> | undefined, err: Error): void {
    if (!job) {
      this.logger.error({ event: 'job.failed', errorMessage: err.message, errorClass: err.name });
      return;
    }
    const maxAttempts = job.opts.attempts ?? 1;
    const permanent = err.name === 'UnrecoverableError' || job.attemptsMade >= maxAttempts;
    const entry = {
      event: permanent ? 'job.failed_permanently' : 'job.failed_will_retry',
      ...jobFields(job),
      maxAttempts,
      failedReason: err.message,
      errorClass: err.name,
    };
    if (permanent) {
      this.logger.error(entry);
    } else {
      this.logger.warn(entry);
    }
  }
}

function jobFields(job: Job<JobEnvelope>) {
  return {
    queue: job.queueName,
    jobId: job.id,
    jobName: job.name,
    attempt: job.attemptsMade,
    correlationId: job.data?.correlationId ?? undefined,
    payload: job.data?.payload,
  };
}
