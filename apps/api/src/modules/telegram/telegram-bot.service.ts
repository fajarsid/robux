import { Inject, Injectable, Logger } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { APP_CONFIG } from '../../config/app-config.module';
import type { AppConfig } from '../../config/app-config';
import { PrismaService } from '../../common/database/prisma.service';

type TelegramUpdate = {
  update_id: number;
  message?: { text?: string; chat?: { id?: number }; from?: { id?: number; username?: string } };
};

/** Small Telegram Bot API boundary: storefront and commerce rules stay in the Core API. */
@Injectable()
export class TelegramBotService {
  private readonly logger = new Logger(TelegramBotService.name);
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  verifyWebhookSecret(actual: string | undefined): boolean {
    const expected = this.config.telegram?.webhookSecret;
    if (!actual || !expected) return false;
    const a = Buffer.from(actual);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  isConfigured(): boolean {
    return this.config.telegram !== null;
  }

  async handleUpdate(update: TelegramUpdate): Promise<void> {
    const seen = await this.prisma.telegramBotUpdate.createMany({
      data: { updateId: BigInt(update.update_id) },
      skipDuplicates: true,
    });
    if (seen.count === 0) return;
    await this.prisma.telegramBotUpdate.deleteMany({
      where: { receivedAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60_000) } },
    });
    const message = update.message;
    const telegramUserId = message?.from?.id;
    const chatId = message?.chat?.id;
    if (!Number.isSafeInteger(telegramUserId) || !Number.isSafeInteger(chatId) || !message?.text)
      return;
    const id = BigInt(telegramUserId!);
    await this.prisma.telegramIdentity.upsert({
      where: { telegramUserId: id },
      create: {
        telegramUserId: id,
        chatId: BigInt(chatId!),
        username: message.from?.username ?? null,
      },
      update: { chatId: BigInt(chatId!), username: message.from?.username ?? null },
    });
    const command =
      (message.text.trim().split(/\s+/, 1)[0] ?? '').toLowerCase().split('@', 1)[0] ?? '';
    if (command === '/start') {
      await this.sendMessage(
        chatId!,
        'Selamat datang!\n\nTelegram Account Store. Buka toko untuk melihat produk yang tersedia.',
        {
          inline_keyboard: [[{ text: '🛍️ Buka Toko', web_app: { url: this.webAppUrl() } }]],
        },
      );
    } else if (command === '/orders') {
      const url = new URL(this.webAppUrl());
      url.searchParams.set('view', 'orders');
      await this.sendMessage(chatId!, 'Lihat status pesanan Anda di Telegram Account Store.', {
        inline_keyboard: [[{ text: '📦 Pesanan Saya', web_app: { url: url.toString() } }]],
      });
    } else if (command === '/help') {
      await this.sendMessage(
        chatId!,
        'Pilih Telegram Account dari toko, selesaikan pembayaran, lalu buka pesanan selesai untuk melihat secure handoff. Hubungi support jika pesanan memerlukan bantuan.',
      );
    }
  }

  async sendOrderNotification(chatId: bigint, text: string, webAppUrl?: string): Promise<void> {
    await this.sendMessage(
      Number(chatId),
      text,
      webAppUrl
        ? { inline_keyboard: [[{ text: 'Buka Pesanan', web_app: { url: webAppUrl } }]] }
        : undefined,
    );
  }

  orderUrl(orderNumber: string): string | undefined {
    const configured = this.config.telegram?.miniAppUrl;
    if (!configured) return undefined;
    const url = new URL(configured);
    url.searchParams.set('view', 'orders');
    url.searchParams.set('order', orderNumber);
    return url.toString();
  }

  private webAppUrl(): string {
    const url = this.config.telegram?.miniAppUrl;
    if (!url) throw new Error('Telegram Mini App is not configured');
    return url;
  }

  private async sendMessage(
    chatId: number,
    text: string,
    replyMarkup?: Record<string, unknown>,
  ): Promise<void> {
    const token = this.config.telegram?.botToken;
    if (!token) throw new Error('Telegram bot is not configured');
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok)
        this.logger.warn({ event: 'telegram.bot_send_failed', status: response.status });
    } catch (error) {
      this.logger.warn({
        event: 'telegram.bot_send_unavailable',
        errorClass: error instanceof Error ? error.name : 'UNKNOWN',
      });
    }
  }
}
