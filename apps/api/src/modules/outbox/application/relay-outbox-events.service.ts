import { Inject, Injectable, Logger } from '@nestjs/common';
import type { JobDefinition } from '../../../common/queue/job-definition';
import { QUEUE_PUBLISHER, type QueuePublisher } from '../../../common/queue/queue-publisher';
import {
  OUTBOX_RELAY_REPOSITORY,
  type OutboxDelivery,
  type OutboxRelayRepository,
  type PendingOutboxEvent,
} from '../domain/outbox-relay.repository';
import { OUTBOX_ROUTES, type OutboxEventJobPayload, type OutboxRoute } from './outbox-routes';

export const OUTBOX_RELAY_BATCH_SIZE = 100;

export interface OutboxRelayResult {
  delivered: number;
  failed: number;
}

/**
 * Moves committed outbox events to BullMQ (ARCHITECTURE.md §6.3). The job id is the event id, so a
 * crash after enqueue but before `published_at` is written re-enqueues a job BullMQ already holds
 * and ignores. Delivery stops at the first failure: when Redis is down every later event would
 * fail too, and stopping keeps events in creation order.
 */
@Injectable()
export class RelayOutboxEventsService {
  private readonly logger = new Logger(RelayOutboxEventsService.name);
  private readonly routes = new Map<string, JobDefinition<OutboxEventJobPayload>[]>();

  constructor(
    @Inject(OUTBOX_RELAY_REPOSITORY) private readonly outbox: OutboxRelayRepository,
    @Inject(QUEUE_PUBLISHER) private readonly publisher: QueuePublisher,
    @Inject(OUTBOX_ROUTES) routes: readonly OutboxRoute[],
  ) {
    for (const route of routes) {
      this.routes.set(route.eventType, [...(this.routes.get(route.eventType) ?? []), route.job]);
    }
  }

  hasRoutes(): boolean {
    return this.routes.size > 0;
  }

  async relayOnce(): Promise<OutboxRelayResult> {
    if (!this.hasRoutes()) {
      return { delivered: 0, failed: 0 };
    }
    const outcomes = await this.outbox.relayBatch(
      { eventTypes: [...this.routes.keys()], limit: OUTBOX_RELAY_BATCH_SIZE },
      (events) => this.deliverInOrder(events),
    );
    const delivered = outcomes.filter((o) => o.delivered).length;
    return { delivered, failed: outcomes.length - delivered };
  }

  private async deliverInOrder(events: PendingOutboxEvent[]): Promise<OutboxDelivery[]> {
    const outcomes: OutboxDelivery[] = [];
    for (const event of events) {
      try {
        await this.deliver(event);
        outcomes.push({ eventId: event.id, delivered: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn({
          event: 'outbox.delivery_failed',
          outboxEventId: event.id,
          eventType: event.eventType,
          aggregateId: event.aggregateId,
          attempts: event.attempts + 1,
          correlationId: event.requestId ?? undefined,
          errorMessage: message,
        });
        outcomes.push({ eventId: event.id, delivered: false, error: message });
        break;
      }
    }
    return outcomes;
  }

  private async deliver(event: PendingOutboxEvent): Promise<void> {
    const payload: OutboxEventJobPayload = {
      eventId: event.id,
      eventType: event.eventType,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
    };
    for (const job of this.routes.get(event.eventType) ?? []) {
      await this.publisher.publish(job, payload, {
        jobId: event.id,
        correlationId: event.requestId,
      });
    }
  }
}
