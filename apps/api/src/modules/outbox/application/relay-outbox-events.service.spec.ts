import { defineJob } from '../../../common/queue/job-definition';
import type { QueuePublisher } from '../../../common/queue/queue-publisher';
import type {
  OutboxDelivery,
  OutboxRelayRepository,
  PendingOutboxEvent,
} from '../domain/outbox-relay.repository';
import { OUTBOX_EVENT_JOB_PAYLOAD, type OutboxRoute } from './outbox-routes';
import { RelayOutboxEventsService } from './relay-outbox-events.service';

const JOB = defineJob({ queue: 'payment', name: 'test.event', payload: OUTBOX_EVENT_JOB_PAYLOAD });
const ROUTES: OutboxRoute[] = [{ eventType: 'ORDER_EXPIRED', job: JOB }];

function event(id: string): PendingOutboxEvent {
  return {
    id,
    aggregateType: 'order',
    aggregateId: '01900000-0000-7000-8000-000000000001',
    eventType: 'ORDER_EXPIRED',
    requestId: 'req-1',
    attempts: 0,
  };
}

function repositoryWith(events: PendingOutboxEvent[]) {
  let outcomes: OutboxDelivery[] = [];
  const repository: OutboxRelayRepository = {
    relayBatch: jest.fn(async (_query, deliver) => {
      outcomes = await deliver(events);
      return outcomes;
    }),
  };
  return { repository, outcomes: () => outcomes };
}

describe('RelayOutboxEventsService', () => {
  it('does not touch the outbox when no event type is routed', async () => {
    const { repository } = repositoryWith([event('e1')]);
    const publisher: QueuePublisher = { publish: jest.fn() };
    const relay = new RelayOutboxEventsService(repository, publisher, []);
    expect(await relay.relayOnce()).toEqual({ delivered: 0, failed: 0 });
    expect(repository.relayBatch).not.toHaveBeenCalled();
  });

  it('publishes ids only, with the event id as job id and the request id as correlation', async () => {
    const { repository } = repositoryWith([event('e1')]);
    const publisher: QueuePublisher = { publish: jest.fn().mockResolvedValue(undefined) };
    const relay = new RelayOutboxEventsService(repository, publisher, ROUTES);

    expect(await relay.relayOnce()).toEqual({ delivered: 1, failed: 0 });
    expect(repository.relayBatch).toHaveBeenCalledWith(
      { eventTypes: ['ORDER_EXPIRED'], limit: 100 },
      expect.any(Function),
    );
    expect(publisher.publish).toHaveBeenCalledWith(
      JOB,
      {
        eventId: 'e1',
        eventType: 'ORDER_EXPIRED',
        aggregateType: 'order',
        aggregateId: '01900000-0000-7000-8000-000000000001',
      },
      { jobId: 'e1', correlationId: 'req-1' },
    );
  });

  it('stops at the first failure and reports it, leaving later events for the next run', async () => {
    const { repository, outcomes } = repositoryWith([event('e1'), event('e2'), event('e3')]);
    const publisher: QueuePublisher = {
      publish: jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Connection is closed.')),
    };
    const relay = new RelayOutboxEventsService(repository, publisher, ROUTES);

    expect(await relay.relayOnce()).toEqual({ delivered: 1, failed: 1 });
    expect(outcomes()).toEqual([
      { eventId: 'e1', delivered: true },
      { eventId: 'e2', delivered: false, error: 'Connection is closed.' },
    ]);
    expect(publisher.publish).toHaveBeenCalledTimes(2);
  });
});
