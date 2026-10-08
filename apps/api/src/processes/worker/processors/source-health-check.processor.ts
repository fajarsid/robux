import { Injectable, Logger } from '@nestjs/common';
import type { JobContext, PayloadOf } from '../../../common/queue/job-definition';
import type { JobProcessor } from '../../../common/queue/job-processor';
import { SourceHealthCheckService } from '../../../modules/fulfillment/application/source-health-check.service';
import { SOURCE_HEALTH_CHECK_JOB } from '../../jobs/source-health-check.job';

type Payload = PayloadOf<typeof SOURCE_HEALTH_CHECK_JOB>;

/** Safe to run concurrently or twice: each probe only writes the current health of one source. */
@Injectable()
export class SourceHealthCheckProcessor implements JobProcessor<Payload> {
  readonly job = SOURCE_HEALTH_CHECK_JOB;
  private readonly logger = new Logger(SourceHealthCheckProcessor.name);

  constructor(private readonly healthCheck: SourceHealthCheckService) {}

  async process(_payload: Payload, context: JobContext): Promise<void> {
    const summary = await this.healthCheck.checkUnavailableSources();
    this.logger.debug({
      event: 'inventory.health_check_completed',
      jobId: context.jobId,
      ...summary,
    });
  }
}
