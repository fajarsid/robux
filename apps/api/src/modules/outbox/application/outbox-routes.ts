import { z } from 'zod';
import type { JobDefinition } from '../../../common/queue/job-definition';

/** Every relayed event becomes a job carrying identifiers only; consumers read the rest from PostgreSQL. */
export const OUTBOX_EVENT_JOB_PAYLOAD = z.object({
  eventId: z.uuid(),
  eventType: z.string().min(1),
  aggregateType: z.string().min(1),
  aggregateId: z.uuid(),
});

export type OutboxEventJobPayload = z.infer<typeof OUTBOX_EVENT_JOB_PAYLOAD>;

export interface OutboxRoute {
  eventType: string;
  job: JobDefinition<OutboxEventJobPayload>;
}

export const OUTBOX_ROUTES = Symbol('OUTBOX_ROUTES');
