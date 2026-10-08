import type { WebhookEventStatus, WebhookSource } from '../../../generated/prisma/enums';

export interface InboundWebhookEvent {
  source: WebhookSource;
  eventKey: string;
  signatureValid: boolean;
  payload: Record<string, string>;
  payloadHash: string;
}

export interface RegisteredWebhookEvent {
  id: string;
  status: WebhookEventStatus;
  /** False when the same event key was received before (a redelivery). */
  firstDelivery: boolean;
}

/** Every inbound gateway notification is persisted; UNIQUE(source, event_key) dedupes redeliveries. */
export interface WebhookEventRepository {
  register(event: InboundWebhookEvent): Promise<RegisteredWebhookEvent>;
  markOutcome(
    id: string,
    status: Exclude<WebhookEventStatus, 'RECEIVED'>,
    errorCode?: string,
  ): Promise<void>;
}

export const WEBHOOK_EVENT_REPOSITORY = Symbol('WEBHOOK_EVENT_REPOSITORY');
