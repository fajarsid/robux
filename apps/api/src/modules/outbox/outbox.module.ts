import { Module } from '@nestjs/common';
import { QueueModule } from '../../common/queue/queue.module';
import type { AppConfig } from '../../config/app-config';
import { APP_CONFIG } from '../../config/app-config.module';
import { outboxRoutesFor } from './application/outbox-route-table';
import { OUTBOX_ROUTES } from './application/outbox-routes';
import { RelayOutboxEventsService } from './application/relay-outbox-events.service';
import { OUTBOX_EVENT_READER } from './domain/outbox-event.reader';
import { OUTBOX_RELAY_REPOSITORY } from './domain/outbox-relay.repository';
import { PrismaOutboxEventReader } from './infrastructure/prisma-outbox-event.reader';
import { PrismaOutboxRelayRepository } from './infrastructure/prisma-outbox-relay.repository';

/** Outbox delivery (worker process). Events are written by each module inside its own transaction. */
@Module({
  imports: [QueueModule],
  providers: [
    RelayOutboxEventsService,
    { provide: OUTBOX_RELAY_REPOSITORY, useClass: PrismaOutboxRelayRepository },
    { provide: OUTBOX_EVENT_READER, useClass: PrismaOutboxEventReader },
    {
      provide: OUTBOX_ROUTES,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => outboxRoutesFor(config.fulfillment),
    },
  ],
  exports: [RelayOutboxEventsService, OUTBOX_EVENT_READER],
})
export class OutboxModule {}
