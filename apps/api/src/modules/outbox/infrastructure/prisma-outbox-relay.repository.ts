import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import type {
  OutboxDelivery,
  OutboxRelayQuery,
  OutboxRelayRepository,
  PendingOutboxEvent,
} from '../domain/outbox-relay.repository';

interface PendingRow {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  request_id: string | null;
  attempts: number;
}

const MAX_ERROR_LENGTH = 500;
/** Covers one batch of Redis round-trips; producers fail fast while Redis is down. */
const RELAY_TRANSACTION_TIMEOUT_MS = 30_000;

@Injectable()
export class PrismaOutboxRelayRepository implements OutboxRelayRepository {
  constructor(private readonly prisma: PrismaService) {}

  relayBatch(
    query: OutboxRelayQuery,
    deliver: (events: PendingOutboxEvent[]) => Promise<OutboxDelivery[]>,
  ): Promise<OutboxDelivery[]> {
    return this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<PendingRow[]>`
          SELECT id::text, aggregate_type, aggregate_id::text, event_type, request_id, attempts
            FROM outbox_events
           WHERE published_at IS NULL
             AND event_type = ANY(${[...query.eventTypes]}::text[])
           ORDER BY created_at, id
           LIMIT ${query.limit}
             FOR UPDATE SKIP LOCKED`;
        if (rows.length === 0) {
          return [];
        }
        const outcomes = await deliver(rows.map(toPendingEvent));
        const delivered = outcomes.filter((o) => o.delivered).map((o) => o.eventId);
        if (delivered.length > 0) {
          await tx.$executeRaw`
            UPDATE outbox_events
               SET published_at = now(), attempts = attempts + 1, last_error = NULL
             WHERE id = ANY(${delivered}::uuid[])`;
        }
        for (const failure of outcomes) {
          if (!failure.delivered) {
            await tx.$executeRaw`
              UPDATE outbox_events
                 SET attempts = attempts + 1,
                     last_error = ${failure.error.slice(0, MAX_ERROR_LENGTH)}
               WHERE id = ${failure.eventId}::uuid`;
          }
        }
        return outcomes;
      },
      { timeout: RELAY_TRANSACTION_TIMEOUT_MS },
    );
  }
}

function toPendingEvent(row: PendingRow): PendingOutboxEvent {
  return {
    id: row.id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    eventType: row.event_type,
    requestId: row.request_id,
    attempts: row.attempts,
  };
}
