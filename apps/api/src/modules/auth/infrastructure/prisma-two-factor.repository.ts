import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import type { TwoFactorRecord, TwoFactorRepository } from '../domain/ports';

@Injectable()
export class PrismaTwoFactorRepository implements TwoFactorRepository {
  constructor(private readonly prisma: PrismaService) {}

  async find(userId: string): Promise<TwoFactorRecord | null> {
    const row = await this.prisma.adminTwoFactor.findUnique({ where: { userId } });
    if (!row) {
      return null;
    }
    return {
      userId: row.userId,
      secretCiphertext: Buffer.from(row.secretCiphertext),
      keyVersion: row.keyVersion,
      enabledAt: row.enabledAt,
      lastUsedStep: row.lastUsedStep === null ? null : Number(row.lastUsedStep),
    };
  }

  async savePendingSecret(
    userId: string,
    secretCiphertext: Buffer,
    keyVersion: number,
  ): Promise<boolean> {
    const data = {
      secretCiphertext: new Uint8Array(secretCiphertext),
      keyVersion,
      lastUsedStep: null,
    };
    const existing = await this.prisma.adminTwoFactor.findUnique({ where: { userId } });
    if (!existing) {
      await this.prisma.adminTwoFactor.create({ data: { userId, ...data } });
      return true;
    }
    const { count } = await this.prisma.adminTwoFactor.updateMany({
      where: { userId, enabledAt: null },
      data,
    });
    return count === 1;
  }

  async claimStep(userId: string, step: number): Promise<boolean> {
    const { count } = await this.prisma.adminTwoFactor.updateMany({
      where: {
        userId,
        enabledAt: { not: null },
        OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: BigInt(step) } }],
      },
      data: { lastUsedStep: BigInt(step) },
    });
    return count === 1;
  }

  enableWithRecoveryCodes(
    userId: string,
    step: number,
    codeHashes: string[],
    now: Date,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.adminTwoFactor.updateMany({
        where: { userId, enabledAt: null },
        data: { enabledAt: now, lastUsedStep: BigInt(step) },
      });
      if (count === 0) {
        return false;
      }
      await tx.adminRecoveryCode.deleteMany({ where: { userId } });
      await tx.adminRecoveryCode.createMany({
        data: codeHashes.map((codeHash) => ({ userId, codeHash })),
      });
      return true;
    });
  }

  listUnusedRecoveryCodes(userId: string): Promise<{ id: string; codeHash: string }[]> {
    return this.prisma.adminRecoveryCode.findMany({
      where: { userId, usedAt: null },
      select: { id: true, codeHash: true },
    });
  }

  async consumeRecoveryCode(codeId: string, now: Date): Promise<boolean> {
    const { count } = await this.prisma.adminRecoveryCode.updateMany({
      where: { id: codeId, usedAt: null },
      data: { usedAt: now },
    });
    return count === 1;
  }
}
