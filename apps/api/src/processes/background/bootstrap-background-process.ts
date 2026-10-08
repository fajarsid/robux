import 'reflect-metadata';
import { Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { loadConfig, ServiceName } from '../../config/app-config';
import { BackgroundProcessModule } from './background-process.module';
import { installFatalErrorHandlers } from '../../common/lifecycle/fatal-error-handlers';

/** Boots a non-HTTP Nest application context with health server and graceful shutdown. */
export async function bootstrapBackgroundProcess(
  service: Exclude<ServiceName, 'api'>,
  processModule: Type<unknown>,
): Promise<void> {
  installFatalErrorHandlers(service);
  const config = loadConfig(service);
  const app = await NestFactory.createApplicationContext(
    BackgroundProcessModule.forRoot(config, processModule),
    { bufferLogs: true },
  );
  app.useLogger(app.get(Logger));
  // SIGTERM/SIGINT → shutdown hooks: the runtime drains first, then queues, then DB/Redis close.
  app.enableShutdownHooks();
  await app.init();
  app.get(Logger).log({ event: `${service}.started` });
}
