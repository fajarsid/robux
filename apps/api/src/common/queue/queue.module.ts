import { Module } from '@nestjs/common';
import { BullMqJobScheduleRegistrar } from './bullmq-job-schedule.registrar';
import { BullMqQueuePublisher } from './bullmq-queue.publisher';
import { BullMqQueueRegistry } from './bullmq-queue.registry';
import { QUEUE_PUBLISHER } from './queue-publisher';

/**
 * Producer-side queue infrastructure. Not global on purpose: Nest destroys non-global modules
 * before global ones and importers before their imports, so worker consumers stop before these
 * queues close, and queues close before the shared Redis and PostgreSQL clients.
 */
@Module({
  providers: [
    BullMqQueueRegistry,
    BullMqJobScheduleRegistrar,
    { provide: QUEUE_PUBLISHER, useClass: BullMqQueuePublisher },
  ],
  exports: [BullMqQueueRegistry, BullMqJobScheduleRegistrar, QUEUE_PUBLISHER],
})
export class QueueModule {}
