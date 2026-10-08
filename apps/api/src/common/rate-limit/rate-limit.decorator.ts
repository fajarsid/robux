import { SetMetadata } from '@nestjs/common';

/**
 * What a limit is counted per. `email` values are hashed before they reach Redis.
 * `principal` falls back to `ip` for anonymous requests.
 */
export type RateLimitScope = 'ip' | 'ip-email' | 'principal';

export interface RateLimitRule {
  /** Stable rule name, part of the Redis key. */
  name: string;
  scope: RateLimitScope;
  limit: number;
  windowSeconds: number;
}

export const RATE_LIMIT_RULES = Symbol('RATE_LIMIT_RULES');

/** Every listed rule must pass. Limits are documented in SECURITY.md §7. */
export const RateLimit = (...rules: RateLimitRule[]) => SetMetadata(RATE_LIMIT_RULES, rules);
