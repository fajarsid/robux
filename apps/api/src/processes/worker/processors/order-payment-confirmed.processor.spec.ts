import type { JobContext } from '../../../common/queue/job-definition';
import { parseJobPayload } from '../../../common/queue/job-payload-guard';
import { NonRetryableJobError } from '../../../common/queue/retry-policy';
import type { QueuePaidOrderService } from '../../../modules/orders/application/queue-paid-order.service';
import { OUTBOX_ROUTE_TABLE } from '../../../modules/outbox/application/outbox-route-table';
import type {
  OutboxEventReader,
  StoredOutboxEvent,
} from '../../../modules/outbox/domain/outbox-event.reader';
import { ORDER_PAYMENT_CONFIRMED_JOB } from '../../jobs/order-payment-confirmed.job';
import { OrderPaymentConfirmedProcessor } from './order-payment-confirmed.processor';

const EVENT: StoredOutboxEvent = {
  id: '0192f0a0-0000-7000-8000-0000000000e1',
  eventType: 'PAYMENT_CONFIRMED',
  aggregateType: 'order',
  aggregateId: '0192f0a0-0000-7000-8000-000000000001',
  requestId: 'req-from-callback',
};
const payload = {
  eventId: EVENT.id,
  eventType: EVENT.eventType,
  aggregateType: EVENT.aggregateType,
  aggregateId: EVENT.aggregateId,
};
const context: JobContext = {
  jobId: EVENT.id,
  queue: 'order-processing',
  attempt: 1,
  correlationId: 'req-from-callback',
};

function processor(stored: StoredOutboxEvent | null, outcome = 'QUEUED') {
  const queue = jest.fn().mockResolvedValue(outcome);
  const reader: OutboxEventReader = { findById: async () => stored };
  return {
    queue,
    instance: new OrderPaymentConfirmedProcessor(reader, {
      queue,
    } as unknown as QueuePaidOrderService),
  };
}

describe('order.payment-confirmed job', () => {
  it('routes payment and customer notification events on the shared order-processing queue', () => {
    expect(OUTBOX_ROUTE_TABLE.map((route) => [route.eventType, route.job.name])).toEqual([
      ['PAYMENT_CONFIRMED', 'order.payment-confirmed'],
      ['PAYMENT_CONFIRMED', 'telegram.order-notification'],
      ['FULFILLMENT_COMPLETED', 'telegram.order-notification'],
    ]);
    expect(ORDER_PAYMENT_CONFIRMED_JOB.queue).toBe('order-processing');
    expect(ORDER_PAYMENT_CONFIRMED_JOB.retry).toBeUndefined();
  });

  it('accepts identifiers only and rejects malformed payloads as non-retryable', () => {
    expect(parseJobPayload(ORDER_PAYMENT_CONFIRMED_JOB, payload)).toEqual(payload);
    expect(() =>
      parseJobPayload(ORDER_PAYMENT_CONFIRMED_JOB, { ...payload, eventId: 'not-a-uuid' }),
    ).toThrow(NonRetryableJobError);
    expect(() => parseJobPayload(ORDER_PAYMENT_CONFIRMED_JOB, { eventId: EVENT.id })).toThrow(
      NonRetryableJobError,
    );
  });
});

describe('OrderPaymentConfirmedProcessor', () => {
  it('queues the order named by the committed event, carrying the correlation id', async () => {
    const { instance, queue } = processor(EVENT);
    await instance.process(payload, context);
    expect(queue).toHaveBeenCalledWith(EVENT.aggregateId, {
      outboxEventId: EVENT.id,
      requestId: 'req-from-callback',
    });
  });

  it.each([
    ['an unknown event id', null, payload],
    ['another event type', { ...EVENT, eventType: 'ORDER_CREATED' }, payload],
    [
      'another aggregate',
      EVENT,
      { ...payload, aggregateId: '0192f0a0-0000-7000-8000-000000000002' },
    ],
    ['a forged event type', EVENT, { ...payload, eventType: 'FULFILLMENT_REQUESTED' }],
  ])('refuses a job pointing at %s without retrying', async (_label, stored, jobPayload) => {
    const { instance, queue } = processor(stored);
    await expect(instance.process(jobPayload, context)).rejects.toBeInstanceOf(
      NonRetryableJobError,
    );
    expect(queue).not.toHaveBeenCalled();
  });

  it('fails without retry when the order does not exist', async () => {
    const { instance } = processor(EVENT, 'ORDER_NOT_FOUND');
    await expect(instance.process(payload, context)).rejects.toBeInstanceOf(NonRetryableJobError);
  });

  it.each(['ALREADY_QUEUED', 'NOT_ELIGIBLE'])('acknowledges a %s outcome', async (outcome) => {
    const { instance } = processor(EVENT, outcome);
    await expect(instance.process(payload, context)).resolves.toBeUndefined();
  });

  it('lets infrastructure errors through so the retry policy applies', async () => {
    const reader: OutboxEventReader = {
      findById: async () => {
        throw new Error('connection terminated');
      },
    };
    const instance = new OrderPaymentConfirmedProcessor(reader, {} as QueuePaidOrderService);
    const error = await instance.process(payload, context).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(NonRetryableJobError);
  });
});
