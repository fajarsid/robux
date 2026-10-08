import { Inject, Injectable } from '@nestjs/common';
import { type Job, UnrecoverableError } from 'bullmq';
import type { JobEnvelope, JobPayload } from '../../common/queue/job-definition';
import { parseJobPayload } from '../../common/queue/job-payload-guard';
import { JOB_PROCESSORS, type JobProcessor } from '../../common/queue/job-processor';
import { retryPolicyFor } from '../../common/queue/job-run-options';
import type { QueueName } from '../../common/queue/queue-catalog';
import { NonRetryableJobError, retryDelayMs } from '../../common/queue/retry-policy';

/** Routes a BullMQ job to its processor by job name and translates retry semantics. */
@Injectable()
export class JobDispatcher {
  private readonly processors = new Map<string, JobProcessor>();

  constructor(@Inject(JOB_PROCESSORS) processors: readonly JobProcessor[]) {
    for (const processor of processors) {
      if (this.processors.has(processor.job.name)) {
        throw new Error(`Duplicate processor for job ${processor.job.name}`);
      }
      this.processors.set(processor.job.name, processor);
    }
  }

  queues(): QueueName[] {
    return [...new Set([...this.processors.values()].map((p) => p.job.queue))];
  }

  async dispatch(job: Job<JobEnvelope>): Promise<void> {
    const processor = this.processors.get(job.name);
    if (!processor) {
      throw new UnrecoverableError(`No processor registered for job ${job.name}`);
    }
    try {
      const payload: JobPayload = parseJobPayload(processor.job, job.data?.payload);
      await processor.process(payload, {
        jobId: job.id ?? 'unknown',
        queue: processor.job.queue,
        attempt: job.attemptsMade + 1,
        correlationId: job.data?.correlationId ?? null,
      });
    } catch (error) {
      if (error instanceof NonRetryableJobError) {
        throw new UnrecoverableError(error.message);
      }
      throw error;
    }
  }

  retryDelay(attemptsMade: number, jobName: string): number {
    const processor = this.processors.get(jobName);
    return processor ? retryDelayMs(retryPolicyFor(processor.job), attemptsMade) : 0;
  }
}
