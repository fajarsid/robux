import { Module } from '@nestjs/common';
import { READINESS_PROBES } from '../../common/health/readiness-probe';
import { QueueModule } from '../../common/queue/queue.module';
import { SchedulerRuntime } from './scheduler.runtime';

/** Scheduler process: owns BullMQ job schedulers, runs no business logic itself. */
@Module({
  imports: [QueueModule],
  providers: [
    SchedulerRuntime,
    {
      provide: READINESS_PROBES,
      useFactory: (runtime: SchedulerRuntime) => [runtime],
      inject: [SchedulerRuntime],
    },
  ],
  exports: [READINESS_PROBES],
})
export class SchedulerModule {}
