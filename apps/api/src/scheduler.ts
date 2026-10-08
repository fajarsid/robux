import { bootstrapBackgroundProcess } from './processes/background/bootstrap-background-process';
import { SchedulerModule } from './processes/scheduler/scheduler.module';

void bootstrapBackgroundProcess('scheduler', SchedulerModule);
