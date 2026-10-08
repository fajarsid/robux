import { Inject, Injectable } from '@nestjs/common';
import type { JobContext, PayloadOf } from '../../../common/queue/job-definition';
import type { JobProcessor } from '../../../common/queue/job-processor';
import { retryPolicyFor } from '../../../common/queue/job-run-options';
import { NonRetryableJobError } from '../../../common/queue/retry-policy';
import {
  FulfillmentEngine,
  type FulfillmentRunOutcome,
} from '../../../modules/fulfillment/application/fulfillment-engine.service';
import { ORDER_AGGREGATE, OrderEvent } from '../../../modules/orders/domain/order-events';
import {
  OUTBOX_EVENT_READER,
  type OutboxEventReader,
} from '../../../modules/outbox/domain/outbox-event.reader';
import { FULFILLMENT_REQUESTED_JOB } from '../../jobs/fulfillment-requested.job';

type Payload = PayloadOf<typeof FULFILLMENT_REQUESTED_JOB>;

/**
 * Thrown to have the job run again after the retry policy's backoff: the order's fulfillment is not
 * finished (retry scheduled, verification pending, or another run held the order). Not a fault.
 */
export class FulfillmentContinuesError extends Error {
  constructor(readonly outcome: FulfillmentRunOutcome) {
    super(`Fulfillment continues: ${outcome}`);
    this.name = 'FulfillmentContinuesError';
  }
}

const CONTINUING: ReadonlySet<FulfillmentRunOutcome> = new Set([
  'RETRY_SCHEDULED',
  'AWAITING_VERIFICATION',
  'BUSY',
  'CONFLICT',
  'NEXT_ALLOCATION',
]);

/**
 * Consumes FULFILLMENT_REQUESTED. The job is a pointer to a committed outbox row; the engine reads
 * the order from PostgreSQL. Duplicate deliveries are harmless: the order's lease and status
 * decide what a run may do, never the job.
 */
@Injectable()
export class FulfillmentRequestedProcessor implements JobProcessor<Payload> {
  readonly job = FULFILLMENT_REQUESTED_JOB;

  constructor(
    @Inject(OUTBOX_EVENT_READER) private readonly outboxEvents: OutboxEventReader,
    private readonly engine: FulfillmentEngine,
  ) {}

  async process(payload: Payload, context: JobContext): Promise<void> {
    const event = await this.outboxEvents.findById(payload.eventId);
    if (
      !event ||
      event.eventType !== OrderEvent.FULFILLMENT_REQUESTED ||
      event.aggregateType !== ORDER_AGGREGATE ||
      event.eventType !== payload.eventType ||
      event.aggregateId !== payload.aggregateId
    ) {
      throw new NonRetryableJobError('Job does not match a committed FULFILLMENT_REQUESTED event');
    }

    const maxAttempts = retryPolicyFor(this.job).maxAttempts;
    const outcome = await this.engine.run(event.aggregateId, {
      eventId: event.id,
      correlationId: context.correlationId ?? event.requestId,
      maxAttempts,
      finalRun: context.attempt >= maxAttempts,
    });
    if (outcome === 'ORDER_NOT_FOUND') {
      throw new NonRetryableJobError(`Order ${event.aggregateId} of event ${event.id} not found`);
    }
    if (CONTINUING.has(outcome)) {
      throw new FulfillmentContinuesError(outcome);
    }
  }
}
