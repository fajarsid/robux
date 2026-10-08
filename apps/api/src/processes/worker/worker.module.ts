import { Module } from '@nestjs/common';
import { READINESS_PROBES } from '../../common/health/readiness-probe';
import { JOB_PROCESSORS } from '../../common/queue/job-processor';
import { FulfillmentModule } from '../../modules/fulfillment/fulfillment.module';
import { OrderLifecycleJobsModule } from '../../modules/orders/orders.module';
import { OutboxModule } from '../../modules/outbox/outbox.module';
import { JobDispatcher } from './job-dispatcher';
import { OutboxRelayLoop } from './outbox-relay.loop';
import { FulfillmentRequestedProcessor } from './processors/fulfillment-requested.processor';
import { OrderPaymentConfirmedProcessor } from './processors/order-payment-confirmed.processor';
import { PaymentExpirySweepProcessor } from './processors/payment-expiry-sweep.processor';
import { SourceHealthCheckProcessor } from './processors/source-health-check.processor';
import { QueueConsumerHost } from './queue-consumer.host';
import { TelegramBotModule } from '../../modules/telegram/telegram-bot.module';
import { TelegramOrderNotificationProcessor } from './processors/telegram-order-notification.processor';

const processors = [
  PaymentExpirySweepProcessor,
  OrderPaymentConfirmedProcessor,
  FulfillmentRequestedProcessor,
  SourceHealthCheckProcessor,
  TelegramOrderNotificationProcessor,
];

/** Worker process: BullMQ consumers and the outbox relay. */
@Module({
  imports: [OutboxModule, OrderLifecycleJobsModule, FulfillmentModule, TelegramBotModule],
  providers: [
    ...processors,
    { provide: JOB_PROCESSORS, useFactory: (...all: unknown[]) => all, inject: processors },
    JobDispatcher,
    QueueConsumerHost,
    OutboxRelayLoop,
    {
      provide: READINESS_PROBES,
      useFactory: (host: QueueConsumerHost) => [host],
      inject: [QueueConsumerHost],
    },
  ],
  exports: [READINESS_PROBES],
})
export class WorkerModule {}
