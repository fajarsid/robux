import type { JobContext } from '../../../common/queue/job-definition';
import { parseJobPayload } from '../../../common/queue/job-payload-guard';
import { NonRetryableJobError } from '../../../common/queue/retry-policy';
import type { FulfillmentEngine } from '../../../modules/fulfillment/application/fulfillment-engine.service';
import { outboxRoutesFor } from '../../../modules/outbox/application/outbox-route-table';
import type {
  OutboxEventReader,
  StoredOutboxEvent,
} from '../../../modules/outbox/domain/outbox-event.reader';
import { FULFILLMENT_REQUESTED_JOB } from '../../jobs/fulfillment-requested.job';
import {
  FulfillmentContinuesError,
  FulfillmentRequestedProcessor,
} from './fulfillment-requested.processor';

const EVENT: StoredOutboxEvent = {
  id: '0192f0a0-0000-7000-8000-0000000000f1',
  eventType: 'FULFILLMENT_REQUESTED',
  aggregateType: 'order',
  aggregateId: '0192f0a0-0000-7000-8000-000000000001',
  requestId: 'req-from-payment',
};
const payload = {
  eventId: EVENT.id,
  eventType: EVENT.eventType,
  aggregateType: EVENT.aggregateType,
  aggregateId: EVENT.aggregateId,
};
const context = (attempt = 1): JobContext => ({
  jobId: EVENT.id,
  queue: 'fulfillment',
  attempt,
  correlationId: 'req-from-payment',
});

function processor(stored: StoredOutboxEvent | null, outcome = 'FULFILLED') {
  const run = jest.fn().mockResolvedValue(outcome);
  const reader: OutboxEventReader = { findById: async () => stored };
  return {
    run,
    instance: new FulfillmentRequestedProcessor(reader, { run } as unknown as FulfillmentEngine),
  };
}

describe('fulfillment.requested job', () => {
  it('is routed only when a fulfillment provider is configured', () => {
    const routed = (provider: 'none' | 'mock') =>
      outboxRoutesFor({ provider, mock: null }).map((r) => [r.eventType, r.job.name]);
    expect(routed('none')).toEqual([
      ['PAYMENT_CONFIRMED', 'order.payment-confirmed'],
      ['PAYMENT_CONFIRMED', 'telegram.order-notification'],
      ['FULFILLMENT_COMPLETED', 'telegram.order-notification'],
    ]);
    expect(routed('mock')).toEqual([
      ['PAYMENT_CONFIRMED', 'order.payment-confirmed'],
      ['PAYMENT_CONFIRMED', 'telegram.order-notification'],
      ['FULFILLMENT_COMPLETED', 'telegram.order-notification'],
      ['FULFILLMENT_REQUESTED', 'fulfillment.requested'],
    ]);
  });

  it('lives on the fulfillment queue with the canonical retry policy and an ids-only payload', () => {
    expect(FULFILLMENT_REQUESTED_JOB.queue).toBe('fulfillment');
    expect(FULFILLMENT_REQUESTED_JOB.retry).toBeUndefined();
    expect(parseJobPayload(FULFILLMENT_REQUESTED_JOB, payload)).toEqual(payload);
    expect(() =>
      parseJobPayload(FULFILLMENT_REQUESTED_JOB, { ...payload, aggregateId: 'x' }),
    ).toThrow(NonRetryableJobError);
  });
});

describe('FulfillmentRequestedProcessor', () => {
  it('runs the engine for the order of the committed event, with correlation and run budget', async () => {
    const { instance, run } = processor(EVENT);
    await instance.process(payload, context(1));
    expect(run).toHaveBeenCalledWith(EVENT.aggregateId, {
      eventId: EVENT.id,
      correlationId: 'req-from-payment',
      maxAttempts: 5,
      finalRun: false,
    });
  });

  it('tells the engine when the job has no run left', async () => {
    const { instance, run } = processor(EVENT, 'FAILED_PERMANENTLY');
    await instance.process(payload, context(5));
    expect(run.mock.calls[0][1]).toMatchObject({ finalRun: true });
  });

  it.each([
    ['a missing event', null, payload],
    ['another event type', { ...EVENT, eventType: 'PAYMENT_CONFIRMED' }, payload],
    [
      'a forged aggregate',
      EVENT,
      { ...payload, aggregateId: '0192f0a0-0000-7000-8000-0000000000ff' },
    ],
    ['a forged event type', EVENT, { ...payload, eventType: 'PAYMENT_CONFIRMED' }],
  ])(
    'refuses %s without retrying and without touching the order',
    async (_label, stored, input) => {
      const { instance, run } = processor(stored as StoredOutboxEvent | null);
      await expect(instance.process(input, context())).rejects.toThrow(NonRetryableJobError);
      expect(run).not.toHaveBeenCalled();
    },
  );

  it.each(['FULFILLED', 'FAILED_PERMANENTLY', 'RECONCILIATION_REQUIRED', 'NOT_ELIGIBLE'])(
    'acknowledges %s',
    async (outcome) => {
      await expect(
        processor(EVENT, outcome).instance.process(payload, context()),
      ).resolves.toBeUndefined();
    },
  );

  it.each(['RETRY_SCHEDULED', 'AWAITING_VERIFICATION', 'BUSY', 'CONFLICT'])(
    'runs again after the backoff for %s',
    async (outcome) => {
      await expect(processor(EVENT, outcome).instance.process(payload, context())).rejects.toThrow(
        FulfillmentContinuesError,
      );
    },
  );

  it('fails an event whose order does not exist without retrying', async () => {
    await expect(
      processor(EVENT, 'ORDER_NOT_FOUND').instance.process(payload, context()),
    ).rejects.toThrow(NonRetryableJobError);
  });
});
