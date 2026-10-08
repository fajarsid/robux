import { Inject, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '@robux/shared';
import { PrismaService } from '../../common/database/prisma.service';
import { APP_CONFIG } from '../../config/app-config.module';
import type { AppConfig } from '../../config/app-config';

export interface TelegramMiniAppUser {
  id: bigint;
  username: string | null;
}

@Injectable()
export class TelegramMiniAppAuthService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  async authenticate(authorization: string | undefined): Promise<TelegramMiniAppUser> {
    const token = this.config.telegram?.botToken;
    const initData = authorization?.startsWith('tma ') ? authorization.slice(4) : '';
    if (!token || !initData || initData.length > 8192) return this.rejected();
    const params = new URLSearchParams(initData);
    const entries = [...params.entries()];
    if (new Set(entries.map(([key]) => key)).size !== entries.length) return this.rejected();
    const suppliedHash = params.get('hash');
    const authDateRaw = params.get('auth_date');
    const userRaw = params.get('user');
    if (!suppliedHash || !/^[a-f0-9]{64}$/i.test(suppliedHash) || !authDateRaw || !userRaw) {
      return this.rejected();
    }
    const authDate = Number(authDateRaw);
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isSafeInteger(authDate) || authDate > now + 60 || now - authDate > 86_400) {
      return this.rejected();
    }
    const checkString = entries
      .filter(([key]) => key !== 'hash')
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
    const secret = createHmac('sha256', 'WebAppData').update(token).digest();
    const expected = createHmac('sha256', secret).update(checkString).digest();
    const actual = Buffer.from(suppliedHash, 'hex');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return this.rejected();
    let user: { id?: unknown; username?: unknown };
    try {
      user = JSON.parse(userRaw) as { id?: unknown; username?: unknown };
    } catch {
      return this.rejected();
    }
    if (typeof user.id !== 'number' || !Number.isSafeInteger(user.id) || user.id <= 0) {
      return this.rejected();
    }
    const id = BigInt(user.id);
    const username = typeof user.username === 'string' ? user.username.slice(0, 64) : null;
    await this.prisma.telegramIdentity.upsert({
      where: { telegramUserId: id },
      create: { telegramUserId: id, chatId: id, username },
      update: { username },
    });
    return { id, username };
  }

  private rejected(): never {
    throw new DomainError(ErrorCode.FORBIDDEN, 'Telegram session tidak valid. Buka ulang Mini App dari bot.');
  }
}
