import { Module } from '@nestjs/common';
import { RateLimitGuard } from './rate-limit.guard';
import { RedisRateLimiter } from './redis-rate-limiter';

@Module({
  providers: [RedisRateLimiter, RateLimitGuard],
  exports: [RateLimitGuard],
})
export class RateLimitModule {}
