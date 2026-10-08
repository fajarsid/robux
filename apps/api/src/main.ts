import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { installFatalErrorHandlers } from './common/lifecycle/fatal-error-handlers';
import { loadConfig } from './config/app-config';
import { configureHttpApp } from './configure-http-app';

async function bootstrap(): Promise<void> {
  installFatalErrorHandlers('api');
  const config = loadConfig('api');

  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  configureHttpApp(app, config);

  // SIGTERM from `docker stop` → Nest closes providers (DB, Redis) before exit.
  app.enableShutdownHooks();

  await app.listen(config.apiPort, config.apiHost);
  app.get(Logger).log({ event: 'api.started', host: config.apiHost, port: config.apiPort });
}

void bootstrap();
