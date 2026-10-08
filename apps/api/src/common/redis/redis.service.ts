import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfig } from '../../config/app-config';
import { APP_CONFIG } from '../../config/app-config.module';

const CONNECT_WAIT_MS = 5_000;

/**
 * Shared Redis connection for health checks, caching and rate limiting.
 * BullMQ (Phase 7) creates its own connections with queue-specific options.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.client = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      connectionName: `robux-${config.service}`,
      // Fail fast while disconnected instead of queueing commands indefinitely.
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy: (attempt) => Math.min(attempt * 500, 5_000),
    });
    this.client.on('error', (err: Error) =>
      this.logger.warn({ event: 'redis.connection_error', errorMessage: err.message }),
    );
  }

  /**
   * Waits briefly for the first connection so requests right after boot do not fail. If Redis is
   * still down after that, startup continues and readiness reports it.
   */
  async onModuleInit(): Promise<void> {
    if (this.client.status === 'ready') {
      return;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, CONNECT_WAIT_MS);
      this.client.once('ready', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  async ping(): Promise<void> {
    const reply = await this.client.ping();
    if (reply !== 'PONG') {
      throw new Error('Unexpected Redis PING reply');
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }
}
