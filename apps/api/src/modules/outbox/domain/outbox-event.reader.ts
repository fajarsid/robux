export interface StoredOutboxEvent {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  requestId: string | null;
}

/**
 * Lets a consumer check a job against the event that was actually committed: a job payload is
 * untrusted input, the outbox row is the authority.
 */
export interface OutboxEventReader {
  findById(eventId: string): Promise<StoredOutboxEvent | null>;
}

export const OUTBOX_EVENT_READER = Symbol('OUTBOX_EVENT_READER');
