import type { PrismaClient } from '../../src/generated/prisma/client';
import {
  DEFAULT_SYSTEM_SETTINGS,
  DEVELOPMENT_PRODUCTS,
  DEVELOPMENT_SOURCES,
} from '../../src/seed/development-catalog';
import {
  DEVELOPMENT_ACCOUNT_PASSWORD,
  DEVELOPMENT_ACCOUNTS,
} from '../../src/modules/auth/domain/development-accounts';
import { seedDevelopmentData } from '../../src/seed/seed-development-data';
import { createTestPrisma } from './support/test-database';

describe('development seed', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrisma();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function snapshot() {
    const productIds = DEVELOPMENT_PRODUCTS.map((p) => p.id);
    const sourceIds = DEVELOPMENT_SOURCES.map((s) => s.id);
    return {
      products: await prisma.product.findMany({
        where: { id: { in: productIds } },
        orderBy: { id: 'asc' },
      }),
      prices: await prisma.productPrice.findMany({
        where: { productId: { in: productIds } },
        orderBy: { id: 'asc' },
      }),
      sources: await prisma.fulfillmentSource.findMany({
        where: { id: { in: sourceIds } },
        orderBy: { id: 'asc' },
      }),
      ledger: await prisma.sourceBalanceLog.count({ where: { sourceId: { in: sourceIds } } }),
      settings: await prisma.systemSetting.findMany({ orderBy: { key: 'asc' } }),
    };
  }

  it('creates the documented development data', async () => {
    await seedDevelopmentData(prisma);
    const data = await snapshot();

    expect(data.products.map((p) => [p.slug, p.productLine, p.robuxAmount, p.isActive])).toEqual(
      [...DEVELOPMENT_PRODUCTS]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((p) => [p.slug, p.productLine, p.robuxAmount, p.isActive]),
    );
    // Catalog contains Roblox and Telegram variants with no supplier credentials.
    expect(new Set(data.products.map((p) => p.productLine))).toEqual(
      new Set(['ROBLOX_ROBUX', 'TELEGRAM_PREMIUM', 'TELEGRAM_STARS', 'TELEGRAM_ACCOUNT']),
    );
    expect(data.products.filter((p) => p.productLine === 'TELEGRAM_PREMIUM')).toHaveLength(4);
    expect(data.products.filter((p) => p.productLine === 'TELEGRAM_STARS')).toHaveLength(5);
    expect(data.products.filter((p) => p.productLine === 'TELEGRAM_ACCOUNT')).toHaveLength(1);
    expect(
      data.products.filter((p) => p.productLine === 'TELEGRAM_ACCOUNT').every((p) => p.isActive),
    ).toBe(true);
    expect(data.prices).toHaveLength(DEVELOPMENT_PRODUCTS.length);
    expect(data.prices.every((p) => p.version === 1 && p.currency === 'IDR')).toBe(true);
    expect(
      data.sources.filter((s) => s.productLine === 'ROBLOX_ROBUX').map((s) => s.availableBalance),
    ).toEqual([10_000n, 7_500n, 25_000n]);
    expect(
      data.sources
        .filter((s) => s.productLine === 'TELEGRAM_ACCOUNT')
        .map((s) => s.availableBalance),
    ).toEqual([0n]);
    expect(data.ledger).toBe(DEVELOPMENT_SOURCES.length);
    expect(data.settings.map((s) => s.key)).toEqual(
      expect.arrayContaining(DEFAULT_SYSTEM_SETTINGS.map((s) => s.key)),
    );
  });

  it('is deterministic and safe to run again', async () => {
    await seedDevelopmentData(prisma);
    const first = await snapshot();
    await seedDevelopmentData(prisma);
    const second = await snapshot();
    expect(second).toEqual(first);
  });

  it('does not reset balances that changed after seeding', async () => {
    await seedDevelopmentData(prisma);
    const sourceId = DEVELOPMENT_SOURCES[0].id;
    await prisma.fulfillmentSource.update({
      where: { id: sourceId },
      data: { availableBalance: { decrement: 100n }, reservedBalance: { increment: 100n } },
    });
    await seedDevelopmentData(prisma);
    const source = await prisma.fulfillmentSource.findUniqueOrThrow({ where: { id: sourceId } });
    expect(source.reservedBalance).toBe(100n);
  });

  it('creates development accounts only on the reserved .test domain, with hashed passwords', async () => {
    await seedDevelopmentData(prisma);
    const accounts = await prisma.user.findMany({
      where: { id: { in: DEVELOPMENT_ACCOUNTS.map((a) => a.id) } },
      orderBy: { email: 'asc' },
    });
    expect(accounts.map((a) => [a.email, a.role])).toEqual(
      [...DEVELOPMENT_ACCOUNTS]
        .sort((x, y) => x.email.localeCompare(y.email))
        .map((a) => [a.email, a.role]),
    );
    for (const account of accounts) {
      expect(account.email.endsWith('@dev.robux.test')).toBe(true);
      expect(account.passwordHash).toMatch(/^\$argon2id\$/);
      expect(account.passwordHash).not.toContain(DEVELOPMENT_ACCOUNT_PASSWORD);
    }
    const serialised = JSON.stringify(DEVELOPMENT_SOURCES, (_key, value: unknown) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
    expect(serialised).not.toMatch(/password|secret|token|cookie/i);
  });
});
