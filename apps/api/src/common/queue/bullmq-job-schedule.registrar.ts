import { Injectable, Logger } from '@nestjs/common';
import { BullMqQueueRegistry } from './bullmq-queue.registry';
import type { JobDefinition, JobEnvelope, JobPayload } from './job-definition';
import { parseJobPayload } from './job-payload-guard';
import { jobRunOptions } from './job-run-options';
import { QUEUE_NAMES } from './queue-catalog';
import { withQueueTimeout } from './queue-command-timeout';

export interface JobSchedule<P extends JobPayload = JobPayload> {
  job: JobDefinition<P>;
  payload: P;
  everyMs: number;
}

/**
 * Registers repeating jobs as BullMQ job schedulers. The scheduler id is the job name and the call
 * is an upsert, so restarts or a second scheduler process never create a second schedule. Schedules
 * no longer declared are removed: the scheduler process owns every job scheduler in every queue.
 */
@Injectable()
export class BullMqJobScheduleRegistrar {
  private readonly logger = new Logger(BullMqJobScheduleRegistrar.name);

  constructor(private readonly queues: BullMqQueueRegistry) {}

  async register(schedules: readonly JobSchedule[]): Promise<void> {
    for (const schedule of schedules) {
      const data: JobEnvelope = {
        payload: parseJobPayload(schedule.job, schedule.payload),
        correlationId: null,
      };
      await withQueueTimeout(
        this.queues
          .get(schedule.job.queue)
          .upsertJobScheduler(
            schedule.job.name,
            { every: schedule.everyMs },
            { name: schedule.job.name, data, opts: jobRunOptions(schedule.job) },
          ),
        `schedule ${schedule.job.name}`,
      );
    }
    await this.removeUndeclared(new Set(schedules.map((s) => s.job.name)));
  }

  private async removeUndeclared(declared: ReadonlySet<string>): Promise<void> {
    for (const name of QUEUE_NAMES) {
      const queue = this.queues.get(name);
      const existingSchedulers = await withQueueTimeout(
        queue.getJobSchedulers(),
        `list schedules of ${name}`,
      );
      for (const existing of existingSchedulers) {
        if (!declared.has(existing.key)) {
          await withQueueTimeout(
            queue.removeJobScheduler(existing.key),
            `remove schedule ${existing.key}`,
          );
          this.logger.log({
            event: 'scheduler.schedule_removed',
            queue: name,
            schedule: existing.key,
          });
        }
      }
    }
  }
}
