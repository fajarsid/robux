import { Inject, Injectable } from '@nestjs/common';
import { DependencyStatus, ReadinessReport } from '@robux/shared';
import { AppConfig } from '../../config/app-config';
import { APP_CONFIG } from '../../config/app-config.module';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';
import type { ReadinessProbe } from './readiness-probe';

const CHECK_TIMEOUT_MS = 2_000;

async function probe(check: () => Promise<void>): Promise<DependencyStatus> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS);
  });
  try {
    await Promise.race([check(), timeout]);
    return 'up';
  } catch {
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}

/** Readiness = every hard dependency answers within the timeout. Used by api, worker and scheduler. */
@Injectable()
export class DependencyHealthService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async readiness(extra: readonly ReadinessProbe[] = []): Promise<ReadinessReport> {
    const [postgres, redis, ...extraStatuses] = await Promise.all([
      probe(() => this.prisma.ping()),
      probe(() => this.redis.ping()),
      ...extra.map((p) => probe(() => p.check())),
    ]);
    const checks: Record<string, DependencyStatus> = { postgres, redis };
    extra.forEach((p, i) => {
      checks[p.name] = extraStatuses[i] ?? 'down';
    });
    const ready = Object.values(checks).every((s) => s === 'up');
    return { status: ready ? 'ready' : 'not_ready', service: this.config.service, checks };
  }
}
