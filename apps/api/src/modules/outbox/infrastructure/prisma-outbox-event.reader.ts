import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import type { OutboxEventReader, StoredOutboxEvent } from '../domain/outbox-event.reader';

@Injectable()
export class PrismaOutboxEventReader implements OutboxEventReader {
  constructor(private readonly prisma: PrismaService) {}

  findById(eventId: string): Promise<StoredOutboxEvent | null> {
    return this.prisma.outboxEvent.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        eventType: true,
        aggregateType: true,
        aggregateId: true,
        requestId: true,
      },
    });
  }
}
