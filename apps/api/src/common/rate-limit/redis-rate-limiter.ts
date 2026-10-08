import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

/** Rate-limit counters live under `rl:`, apart from BullMQ (`bull:`) and any cache keys. */
export const RATE_LIMIT_KEY_PREFIX = 'rl:';

// INCR and the first EXPIRE run atomically, so a crash between them cannot leave a counter
// without a TTL (which would lock the key out forever).
const FIXED_WINDOW_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return {count, redis.call('TTL', KEYS[1])}
`;

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

@Injectable()
export class RedisRateLimiter {
  constructor(private readonly redis: RedisService) {}

  async consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitDecision> {
    const [count, ttl] = (await this.redis.client.eval(
      FIXED_WINDOW_SCRIPT,
      1,
      RATE_LIMIT_KEY_PREFIX + key,
      windowSeconds,
    )) as [number, number];
    return { allowed: count <= limit, retryAfterSeconds: Math.max(ttl, 1) };
  }
}
