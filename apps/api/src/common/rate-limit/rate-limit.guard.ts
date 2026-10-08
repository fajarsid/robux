import { CanActivate, ExecutionContext, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode } from '@robux/shared';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { AppHttpException, rateLimited } from '../errors/app-http.exception';
import { RATE_LIMIT_RULES, RateLimitRule } from './rate-limit.decorator';
import { RedisRateLimiter } from './redis-rate-limiter';

type RequestWithPrincipal = Request & { principal?: { userId: string } };

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RedisRateLimiter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rules = this.reflector.getAllAndOverride<RateLimitRule[] | undefined>(RATE_LIMIT_RULES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!rules?.length) {
      return true;
    }
    const req = context.switchToHttp().getRequest<RequestWithPrincipal>();
    for (const rule of rules) {
      const key = `${rule.name}:${this.subject(rule, req)}`;
      let decision;
      try {
        decision = await this.limiter.consume(key, rule.limit, rule.windowSeconds);
      } catch (err) {
        // Fail closed: these limits protect authentication endpoints against brute force.
        this.logger.error({ event: 'rate_limit.unavailable', rule: rule.name, err });
        throw new AppHttpException(
          HttpStatus.SERVICE_UNAVAILABLE,
          ErrorCode.SERVICE_UNAVAILABLE,
          'Layanan sedang sibuk. Silakan coba lagi.',
        );
      }
      if (!decision.allowed) {
        this.logger.warn({ event: 'rate_limit.exceeded', rule: rule.name });
        throw rateLimited(decision.retryAfterSeconds);
      }
    }
    return true;
  }

  private subject(rule: RateLimitRule, req: RequestWithPrincipal): string {
    const ip = req.ip ?? 'unknown';
    switch (rule.scope) {
      case 'ip':
        return ip;
      case 'ip-email': {
        const email =
          typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
        return `${ip}:${createHash('sha256').update(email).digest('hex')}`;
      }
      case 'principal':
        return req.principal ? `user:${req.principal.userId}` : `ip:${ip}`;
    }
  }
}
