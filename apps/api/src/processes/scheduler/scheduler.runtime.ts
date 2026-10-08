import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import type { ReadinessProbe } from '../../common/health/readiness-probe';
import { BullMqJobScheduleRegistrar } from '../../common/queue/bullmq-job-schedule.registrar';
import { BullMqQueueRegistry } from '../../common/queue/bullmq-queue.registry';
import { JOB_SCHEDULES } from './job-schedules';

const MAX_RETRY_DELAY_MS = 30_000;

/**
 * Registers the job schedulers in Redis and does nothing else: the worker executes the jobs. The
 * scheduler is the single authoritative trigger for every repeating job; registration is an
 * idempotent upsert, so restarts and a second scheduler instance cannot double-schedule. If Redis
 * is unavailable at start, registration retries with backoff and readiness stays down.
 */
@Injectable()
export class SchedulerRuntime implements OnApplicationBootstrap, OnModuleDestroy, ReadinessProbe {
  readonly name = 'job_schedules';
  private readonly logger = new Logger(SchedulerRuntime.name);
  private registered = false;
  private stopped = false;
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;
  private retryDelayMs = 0;

  constructor(
    private readonly registrar: BullMqJobScheduleRegistrar,
    private readonly queues: BullMqQueueRegistry,
  ) {}

  onApplicationBootstrap(): void {
    this.scheduleRegistration(0);
  }

  async check(): Promise<void> {
    if (!this.registered) {
      throw new Error('Job schedules are not registered');
    }
    for (const queue of new Set(JOB_SCHEDULES.map((s) => s.job.queue))) {
      await this.queues.ping(queue);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
    this.logger.log({ event: 'scheduler.shutdown' });
  }

  private scheduleRegistration(delayMs: number): void {
    if (this.stopped) {
      return;
    }
    this.timer = setTimeout(() => {
      this.running = this.register().finally(() => {
        this.running = undefined;
      });
    }, delayMs);
  }

  private async register(): Promise<void> {
    try {
      await this.registrar.register(JOB_SCHEDULES);
      this.registered = true;
      this.logger.log({
        event: 'scheduler.schedules_registered',
        schedules: JOB_SCHEDULES.map((s) => ({ job: s.job.name, everyMs: s.everyMs })),
      });
    } catch (error) {
      this.retryDelayMs = Math.min(Math.max(this.retryDelayMs * 2, 1_000), MAX_RETRY_DELAY_MS);
      this.logger.warn({
        event: 'scheduler.registration_failed',
        retryInMs: this.retryDelayMs,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      this.scheduleRegistration(this.retryDelayMs);
    }
  }
}
