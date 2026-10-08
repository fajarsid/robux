import type { PrismaClient } from '../generated/prisma/client';
import {
  DEVELOPMENT_ACCOUNT_PASSWORD,
  DEVELOPMENT_ACCOUNTS,
} from '../modules/auth/domain/development-accounts';
import { Argon2PasswordHasher } from '../modules/auth/infrastructure/argon2-password.hasher';
import {
  DEFAULT_SYSTEM_SETTINGS,
  DEVELOPMENT_LOW_BALANCE_THRESHOLD,
  DEVELOPMENT_PRICE_EFFECTIVE_FROM,
  DEVELOPMENT_PRODUCTS,
  DEVELOPMENT_SOURCE_COST_PER_UNIT,
  DEVELOPMENT_SOURCES,
} from './development-catalog';

/**
 * Idempotent: rows are created once and never overwritten, so reruns cannot reset balances
 * that later work has reserved against, and cannot touch append-only price versions.
 */
export async function seedDevelopmentData(prisma: PrismaClient): Promise<void> {
  for (const product of DEVELOPMENT_PRODUCTS) {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.product.findUnique({ where: { id: product.id } });
      if (existing) {
        return;
      }
      await tx.product.create({
        data: {
          id: product.id,
          slug: product.slug,
          name: product.name,
          robuxAmount: product.robuxAmount,
          fulfillmentMethod: 'INSTANT',
          productLine: product.productLine,
          isActive: product.isActive,
          displayOrder: product.displayOrder,
          metadata: { seed: 'development' },
        },
      });
      await tx.productPrice.create({
        data: {
          productId: product.id,
          version: 1,
          sellingPrice: product.sellingPrice,
          costPrice: product.costPrice,
          currency: 'IDR',
          effectiveFrom: DEVELOPMENT_PRICE_EFFECTIVE_FROM,
        },
      });
    });
  }

  for (const source of DEVELOPMENT_SOURCES) {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.fulfillmentSource.findUnique({ where: { id: source.id } });
      if (existing) {
        return;
      }
      await tx.fulfillmentSource.create({
        data: {
          id: source.id,
          provider: 'mock',
          name: source.name,
          productLine: source.productLine,
          priority: source.priority,
          status: 'ACTIVE',
          health: 'HEALTHY',
          availableBalance: source.balance,
          lowBalanceThreshold: DEVELOPMENT_LOW_BALANCE_THRESHOLD,
          currency: 'IDR',
          costPerUnit: DEVELOPMENT_SOURCE_COST_PER_UNIT,
        },
      });
      await tx.sourceBalanceLog.create({
        data: {
          sourceId: source.id,
          reason: 'SYNC',
          deltaAvailable: source.balance,
          deltaReserved: 0n,
          availableAfter: source.balance,
          reservedAfter: 0n,
          note: 'Development seed opening balance',
        },
      });
    });
  }

  const hasher = new Argon2PasswordHasher();
  for (const account of DEVELOPMENT_ACCOUNTS) {
    const existing = await prisma.user.findUnique({ where: { id: account.id } });
    if (existing) {
      continue;
    }
    // Staff accounts start without TOTP: the first admin login walks through 2FA enrollment.
    await prisma.user.create({
      data: {
        id: account.id,
        email: account.email,
        name: account.name,
        role: account.role,
        passwordHash: await hasher.hash(DEVELOPMENT_ACCOUNT_PASSWORD),
        emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
      },
    });
  }

  for (const setting of DEFAULT_SYSTEM_SETTINGS) {
    await prisma.systemSetting.upsert({
      where: { key: setting.key },
      create: { key: setting.key, value: setting.value, description: setting.description },
      update: {},
    });
  }
}
