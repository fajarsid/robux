import { DynamicModule, Module, Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { AppConfigModule } from '../../../src/config/app-config.module';
import { loadConfig, type AppConfig, type ServiceName } from '../../../src/config/app-config';
import { DatabaseModule } from '../../../src/common/database/database.module';
import { testDatabaseUrl } from './test-database';

function testRedisUrl(): URL {
  const url = process.env.TEST_REDIS_URL;
  if (!url) {
    throw new Error('TEST_REDIS_URL is not set; run through jest.integration.config.js');
  }
  return new URL(url);
}

/** A unique BullMQ prefix per test keeps queues of different tests apart in the shared Redis. */
export function uniqueQueuePrefix(): string {
  return `t${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

/** Real configuration loading against the Testcontainers PostgreSQL and Redis. */
export function testProcessConfig(
  service: Exclude<ServiceName, 'api'>,
  overrides: Record<string, string> = {},
): AppConfig {
  const redis = testRedisUrl();
  const database = new URL(testDatabaseUrl());
  return loadConfig(service, {
    NODE_ENV: 'test',
    POSTGRES_HOST: database.hostname,
    POSTGRES_PORT: database.port,
    POSTGRES_DB: database.pathname.slice(1),
    POSTGRES_USER: decodeURIComponent(database.username),
    POSTGRES_PASSWORD: decodeURIComponent(database.password),
    REDIS_HOST: redis.hostname,
    REDIS_PORT: redis.port,
    REDIS_PASSWORD: decodeURIComponent(redis.password),
    QUEUE_PREFIX: uniqueQueuePrefix(),
    WORKER_SHUTDOWN_TIMEOUT_MS: '2000',
    ...overrides,
  });
}

/** Admin connection for assertions and fault injection (CLIENT KILL). */
export function testRedisAdmin(): Redis {
  const url = testRedisUrl();
  return new Redis({
    host: url.hostname,
    port: Number(url.port),
    password: decodeURIComponent(url.password),
  });
}

/**
 * Boots a process module (WorkerModule, SchedulerModule) the way `bootstrapBackgroundProcess`
 * does, minus the health server and logger, so tests exercise the real wiring and lifecycle.
 */
export async function startProcessModule(config: AppConfig, processModule: Type<unknown>) {
  @Module({})
  class TestProcessRoot {
    static forRoot(): DynamicModule {
      return {
        module: TestProcessRoot,
        imports: [AppConfigModule.forRoot(config), DatabaseModule, processModule],
      };
    }
  }
  const app = await NestFactory.createApplicationContext(TestProcessRoot.forRoot(), {
    logger: false,
  });
  await app.init();
  return app;
}

const SILENT_LOGGER = {
  log: () => undefined,
  error: () => undefined,
  warn: () => undefined,
  debug: () => undefined,
  verbose: () => undefined,
};

/**
 * Like `startProcessModule`, with providers replaced by test doubles (for example a provider
 * registry around a mock the test controls). Everything else is the real wiring.
 */
export async function startProcessModuleWith(
  config: AppConfig,
  processModule: Type<unknown>,
  overrides: { provide: unknown; useValue: unknown }[],
) {
  let builder = Test.createTestingModule({
    imports: [AppConfigModule.forRoot(config), DatabaseModule, processModule],
  }).setLogger(SILENT_LOGGER);
  for (const override of overrides) {
    builder = builder.overrideProvider(override.provide).useValue(override.useValue);
  }
  const app = await builder.compile();
  await app.init();
  return app;
}

export async function waitFor<T>(
  probe: () => Promise<T | undefined | null | false>,
  { timeoutMs = 15_000, intervalMs = 50 } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error('Condition not met before timeout');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
