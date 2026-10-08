import { bootstrapBackgroundProcess } from './processes/background/bootstrap-background-process';
import { WorkerModule } from './processes/worker/worker.module';

void bootstrapBackgroundProcess('worker', WorkerModule);
