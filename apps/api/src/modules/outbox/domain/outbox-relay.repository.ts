export interface PendingOutboxEvent {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  requestId: string | null;
  attempts: number;
}

export type OutboxDelivery =
  { eventId: string; delivered: true } | { eventId: string; delivered: false; error: string };

export interface OutboxRelayQuery {
  eventTypes: readonly string[];
  limit: number;
}

export interface OutboxRelayRepository {
  /**
   * Locks up to `limit` unpublished events of the given types, oldest first, with
   * `FOR UPDATE SKIP LOCKED`, hands them to `deliver`, and records every outcome before the locks
   * are released. Concurrent relays therefore never receive the same event. An event is marked
   * published only after `deliver` reports it delivered.
   */
  relayBatch(
    query: OutboxRelayQuery,
    deliver: (events: PendingOutboxEvent[]) => Promise<OutboxDelivery[]>,
  ): Promise<OutboxDelivery[]>;
}

export const OUTBOX_RELAY_REPOSITORY = Symbol('OUTBOX_RELAY_REPOSITORY');
