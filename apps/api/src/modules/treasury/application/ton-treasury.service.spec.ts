import type { AppConfig } from '../../../config/app-config';
import type { PrismaService } from '../../../common/database/prisma.service';
import { TonTreasuryService } from './ton-treasury.service';

const baseConfig = {
  enabled: true,
  binanceWithdrawalEnabled: false,
  minBalanceNano: 20_000_000_000n,
  targetBalanceNano: 100_000_000_000n,
  maxRefillNano: 100_000_000_000n,
  dailyLimitNano: 100_000_000_000n,
  allowedDestinationAddresses: ['EQ-safe-wallet'],
};

function setup(existing: object | null) {
  const tx = {
    $executeRaw: jest.fn(),
    treasuryTransaction: {
      findUnique: jest.fn().mockResolvedValue(existing),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'treasury-1', amountNano: 90_000_000_000n }),
    },
  };
  const prisma = {
    $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
  } as unknown as PrismaService;
  return {
    tx,
    service: new TonTreasuryService({ treasury: baseConfig } as unknown as AppConfig, prisma),
  };
}

describe('TonTreasuryService', () => {
  it('takes a transaction-scoped advisory lock before planning a refill', async () => {
    const { tx, service } = setup(null);
    const result = await service.planRefill(10_000_000_000n, new Date('2026-10-08T12:00:00Z'));
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.treasuryTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          idempotencyKey: 'ton-refill:2026-10-08',
          amountNano: 90_000_000_000n,
          provider: 'BINANCE_DISABLED',
          destinationAddress: 'EQ-safe-wallet',
          status: 'REQUESTED',
        }),
      }),
    );
    expect(result).toMatchObject({
      kind: 'RECORDED',
      transactionId: 'treasury-1',
      execution: 'DISABLED',
    });
  });

  it('returns the existing daily plan rather than creating a duplicate', async () => {
    const { tx, service } = setup({ id: 'treasury-existing', amountNano: 90_000_000_000n });
    const result = await service.planRefill(10_000_000_000n, new Date('2026-10-08T20:00:00Z'));
    expect(tx.treasuryTransaction.findUnique).toHaveBeenCalledWith({
      where: { idempotencyKey: 'ton-refill:2026-10-08' },
    });
    expect(tx.treasuryTransaction.create).not.toHaveBeenCalled();
    expect(result).toMatchObject({ kind: 'RECORDED', transactionId: 'treasury-existing' });
  });
});
