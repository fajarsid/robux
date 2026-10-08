import { Inject, Injectable } from '@nestjs/common';
import type { AppConfig } from '../../../config/app-config';
import { APP_CONFIG } from '../../../config/app-config.module';
import { PrismaService } from '../../../common/database/prisma.service';
import { evaluateTonRefill } from '../domain/ton-refill-policy';

export type RefillPlan =
  | { kind: 'DISABLED' }
  | { kind: 'SUFFICIENT' }
  | { kind: 'MANUAL_REVIEW'; reason: string }
  | {
      kind: 'RECORDED';
      transactionId: string;
      amountNano: bigint;
      execution: 'DISABLED' | 'MANUAL';
    };

/**
 * Safe treasury planning only. This records a request under a database lock; it never calls
 * Binance, signs a transaction, or sends TON. A later authorized adapter must consume the request.
 */
@Injectable()
export class TonTreasuryService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  async planRefill(balanceNano: bigint, now = new Date()): Promise<RefillPlan> {
    const config = this.config.treasury;
    if (!config.enabled) return { kind: 'DISABLED' };
    const utcDay = now.toISOString().slice(0, 10);
    const idempotencyKey = `ton-refill:${utcDay}`;
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ton-treasury-refill'))`;
      const existing = await tx.treasuryTransaction.findUnique({ where: { idempotencyKey } });
      if (existing) {
        return {
          kind: 'RECORDED',
          transactionId: existing.id,
          amountNano: existing.amountNano,
          execution: 'DISABLED',
        } as const;
      }
      const startOfDay = new Date(`${utcDay}T00:00:00.000Z`);
      const endOfDay = new Date(startOfDay.getTime() + 86_400_000);
      const daily = await tx.treasuryTransaction.findMany({
        where: {
          transactionType: 'BINANCE_REFILL',
          createdAt: { gte: startOfDay, lt: endOfDay },
          status: { not: 'FAILED' },
        },
        select: { amountNano: true },
      });
      const dailyRefillNano = daily.reduce((total, row) => total + row.amountNano, 0n);
      const decision = evaluateTonRefill({
        balanceNano,
        dailyRefillNano,
        destinationAddress: config.allowedDestinationAddresses[0] ?? '',
        policy: config,
      });
      if (decision.kind === 'SUFFICIENT') return { kind: 'SUFFICIENT' } as const;
      if (decision.kind === 'MANUAL_REVIEW')
        return { kind: 'MANUAL_REVIEW', reason: decision.reason } as const;
      const request = await tx.treasuryTransaction.create({
        data: {
          idempotencyKey,
          transactionType: 'BINANCE_REFILL',
          asset: 'TON',
          amountNano: decision.amountNano,
          direction: 'INBOUND',
          provider: 'BINANCE_DISABLED',
          destinationAddress: config.allowedDestinationAddresses[0],
          status: 'REQUESTED',
        },
        select: { id: true, amountNano: true },
      });
      return {
        kind: 'RECORDED',
        transactionId: request.id,
        amountNano: request.amountNano,
        execution: 'DISABLED',
      } as const;
    });
  }
}
