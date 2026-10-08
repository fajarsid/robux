import { Injectable } from '@nestjs/common';
import { BullMqQueueRegistry } from './bullmq-queue.registry';
import type { JobDefinition, JobEnvelope, JobPayload } from './job-definition';
import { parseJobPayload } from './job-payload-guard';
import { jobRunOptions } from './job-run-options';
import { withQueueTimeout } from './queue-command-timeout';
import type { PublishOptions, QueuePublisher } from './queue-publisher';

@Injectable()
export class BullMqQueuePublisher implements QueuePublisher {
  constructor(private readonly queues: BullMqQueueRegistry) {}

  async publish<P extends JobPayload>(
    job: JobDefinition<P>,
    payload: P,
    options: PublishOptions = {},
  ): Promise<void> {
    const data: JobEnvelope<P> = {
      payload: parseJobPayload(job, payload),
      correlationId: options.correlationId ?? null,
    };
    await withQueueTimeout(
      this.queues.get(job.queue).add(job.name, data, {
        ...jobRunOptions(job),
        jobId: options.jobId,
        delay: options.delayMs,
      }),
      `publish ${job.name}`,
    );
  }
}
