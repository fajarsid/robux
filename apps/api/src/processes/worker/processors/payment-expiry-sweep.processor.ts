import { Injectable, Logger } from '@nestjs/common';
import type { JobContext, PayloadOf } from '../../../common/queue/job-definition';
import type { JobProcessor } from '../../../common/queue/job-processor';
import { ExpireUnpaidOrdersService } from '../../../modules/orders/application/expire-unpaid-orders.service';
import { PAYMENT_EXPIRY_SWEEP_JOB } from '../../jobs/payment-expiry-sweep.job';

type SweepPayload = PayloadOf<typeof PAYMENT_EXPIRY_SWEEP_JOB>;

/** Safe to run concurrently or twice: every expiry is a conditional PAYMENT_PENDING → CANCELLED. */
@Injectable()
export class PaymentExpirySweepProcessor implements JobProcessor<SweepPayload> {
  readonly job = PAYMENT_EXPIRY_SWEEP_JOB;
  private readonly logger = new Logger(PaymentExpirySweepProcessor.name);

  constructor(private readonly expiry: ExpireUnpaidOrdersService) {}

  async process(_payload: SweepPayload, context: JobContext): Promise<void> {
    const expired = await this.expiry.expireDue();
    this.logger.debug({ event: 'payment.expiry_sweep_completed', jobId: context.jobId, expired });
  }
}
