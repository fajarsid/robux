import { Inject, Injectable, Logger } from '@nestjs/common';
import type { JobContext, PayloadOf } from '../../../common/queue/job-definition';
import type { JobProcessor } from '../../../common/queue/job-processor';
import { NonRetryableJobError } from '../../../common/queue/retry-policy';
import { QueuePaidOrderService } from '../../../modules/orders/application/queue-paid-order.service';
import { ORDER_AGGREGATE, OrderEvent } from '../../../modules/orders/domain/order-events';
import {
  OUTBOX_EVENT_READER,
  type OutboxEventReader,
} from '../../../modules/outbox/domain/outbox-event.reader';
import { ORDER_PAYMENT_CONFIRMED_JOB } from '../../jobs/order-payment-confirmed.job';

type Payload = PayloadOf<typeof ORDER_PAYMENT_CONFIRMED_JOB>;

/**
 * Consumes PAYMENT_CONFIRMED. The job is only a pointer: it must match a committed outbox row,
 * and the order state is read from PostgreSQL. Delivery is at-least-once; a repeated run finds the
 * order already QUEUED and changes nothing.
 */
@Injectable()
export class OrderPaymentConfirmedProcessor implements JobProcessor<Payload> {
  readonly job = ORDER_PAYMENT_CONFIRMED_JOB;
  private readonly logger = new Logger(OrderPaymentConfirmedProcessor.name);

  constructor(
    @Inject(OUTBOX_EVENT_READER) private readonly outboxEvents: OutboxEventReader,
    private readonly queuePaidOrder: QueuePaidOrderService,
  ) {}

  async process(payload: Payload, context: JobContext): Promise<void> {
    const event = await this.outboxEvents.findById(payload.eventId);
    if (
      !event ||
      event.eventType !== OrderEvent.PAYMENT_CONFIRMED ||
      event.aggregateType !== ORDER_AGGREGATE ||
      event.eventType !== payload.eventType ||
      event.aggregateId !== payload.aggregateId
    ) {
      throw new NonRetryableJobError('Job does not match a committed PAYMENT_CONFIRMED event');
    }

    const outcome = await this.queuePaidOrder.queue(event.aggregateId, {
      outboxEventId: event.id,
      requestId: context.correlationId ?? event.requestId ?? undefined,
    });
    const entry = {
      event: 'order.payment_confirmed_processed',
      outcome,
      jobId: context.jobId,
      queue: context.queue,
      jobName: this.job.name,
      attempt: context.attempt,
      eventId: event.id,
      aggregateId: event.aggregateId,
      correlationId: context.correlationId ?? undefined,
    };
    if (outcome === 'ORDER_NOT_FOUND') {
      throw new NonRetryableJobError(`Order ${event.aggregateId} of event ${event.id} not found`);
    }
    if (outcome === 'NOT_ELIGIBLE') {
      this.logger.warn(entry);
    } else {
      this.logger.log(entry);
    }
  }
}
