import type { RedisOptions } from 'ioredis';
import type { AppConfig } from '../../config/app-config';

export type BullMqConnectionRole = 'producer' | 'consumer';

/**
 * BullMQ connection settings derived from the same Redis configuration as `RedisService`, so every
 * process talks to its own environment's Redis (Compose project robux-dev / robux-prod).
 */
export function bullMqConnection(
  config: AppConfig,
  role: BullMqConnectionRole,
  shouldReconnect: () => boolean = () => true,
): RedisOptions {
  const base: RedisOptions = {
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    connectionName: `robux-${config.service}-${role}`,
    retryStrategy: (attempt) =>
      shouldReconnect() ? Math.min(attempt * 500, 5_000) : null,
  };
  if (role === 'consumer') {
    // BullMQ workers hold blocking commands and must keep them across reconnects.
    return { ...base, maxRetriesPerRequest: null };
  }
  // Producers fail fast while Redis is down; their callers (outbox relay, scheduler) retry.
  return { ...base, enableOfflineQueue: false, maxRetriesPerRequest: 1 };
}
