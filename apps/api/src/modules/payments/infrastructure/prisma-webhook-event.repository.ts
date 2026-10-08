import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import type { WebhookEventStatus } from '../../../generated/prisma/enums';
import type {
  InboundWebhookEvent,
  RegisteredWebhookEvent,
  WebhookEventRepository,
} from '../domain/webhook-event.repository';

@Injectable()
export class PrismaWebhookEventRepository implements WebhookEventRepository {
  constructor(private readonly prisma: PrismaService) {}

  async register(event: InboundWebhookEvent): Promise<RegisteredWebhookEvent> {
    // ON CONFLICT DO NOTHING on (source, event_key): a redelivery inserts nothing.
    const { count } = await this.prisma.webhookEvent.createMany({
      data: {
        source: event.source,
        eventKey: event.eventKey,
        signatureValid: event.signatureValid,
        payload: event.payload,
        payloadHash: event.payloadHash,
      },
      skipDuplicates: true,
    });
    const row = await this.prisma.webhookEvent.findUniqueOrThrow({
      where: { source_eventKey: { source: event.source, eventKey: event.eventKey } },
      select: { id: true, status: true },
    });
    return { id: row.id, status: row.status, firstDelivery: count === 1 };
  }

  async markOutcome(
    id: string,
    status: Exclude<WebhookEventStatus, 'RECEIVED'>,
    errorCode?: string,
  ): Promise<void> {
    await this.prisma.webhookEvent.update({
      where: { id },
      data: { status, errorCode: errorCode ?? null, processedAt: new Date() },
    });
  }
}
