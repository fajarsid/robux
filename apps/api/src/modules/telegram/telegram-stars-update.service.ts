import { Inject, Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../../common/database/prisma.service';
import type { RequestContext } from '../../common/http/request-context';
import {
  PAYMENT_GATEWAY,
  gatewayByCode,
  type PaymentGatewayResolver,
} from '../payments/domain/payment-gateway';
import { PAYMENT_REPOSITORY, type PaymentRepository } from '../payments/domain/payment.repository';
import { ProcessPaymentCallbackService } from '../payments/application/process-payment-callback.service';

@Injectable()
export class TelegramStarsUpdateService {
  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly providers: PaymentGatewayResolver,
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    private readonly prisma: PrismaService,
    private readonly callbacks: ProcessPaymentCallbackService,
  ) {}

  async handle(update: Record<string, unknown>, context: RequestContext): Promise<void> {
    if (isRecord(update.pre_checkout_query)) {
      await this.handlePreCheckout(update.pre_checkout_query);
      return;
    }
    if (!isRecord(update.message)) return;
    const successful = update.message.successful_payment;
    if (!isRecord(successful)) return;
    const gateway = gatewayByCode(this.providers, 'TELEGRAM_STARS');
    if (!gateway) return;
    const raw = { contentType: 'application/json', fields: update, sourceIp: 'telegram-webhook' };
    const claim = gateway.verifyCallback(raw);
    const payment = await this.payments.findByMerchantOrderId(claim.merchantOrderId);
    const from = update.message.from;
    const telegramId =
      isRecord(from) && typeof from.id === 'number' && Number.isSafeInteger(from.id)
        ? BigInt(from.id)
        : null;
    const owned =
      payment && telegramId
        ? await this.prisma.telegramOrder.findFirst({
            where: { orderId: payment.orderId, telegramUserId: telegramId },
            select: { orderId: true },
          })
        : null;
    if (!payment || payment.gateway !== 'TELEGRAM_STARS' || !owned) return;
    await this.callbacks.handle('TELEGRAM_STARS', raw, context);
  }

  private async handlePreCheckout(query: Record<string, unknown>): Promise<void> {
    const gateway = gatewayByCode(this.providers, 'TELEGRAM_STARS');
    if (!gateway?.answerPreCheckout) return;
    const queryId = typeof query.id === 'string' ? query.id : '';
    const payload = typeof query.invoice_payload === 'string' ? query.invoice_payload : '';
    const amount = typeof query.total_amount === 'number' ? query.total_amount : -1;
    const currency = query.currency;
    const user = isRecord(query.from) ? query.from : null;
    const telegramId =
      user && typeof user.id === 'number' && Number.isSafeInteger(user.id) ? BigInt(user.id) : null;
    const payment = payload ? await this.payments.findByMerchantOrderId(payload) : null;
    const order =
      payment && telegramId
        ? await this.prisma.order.findFirst({
            where: {
              id: payment.orderId,
              status: 'PAYMENT_PENDING',
              telegramOrder: { is: { telegramUserId: telegramId } },
            },
            select: { id: true },
          })
        : null;
    const valid =
      queryId.length > 0 &&
      currency === 'XTR' &&
      Number.isSafeInteger(amount) &&
      amount > 0 &&
      !!payment &&
      payment.gateway === 'TELEGRAM_STARS' &&
      payment.status === 'PENDING' &&
      payment.currency === 'XTR' &&
      payment.expiresAt !== null &&
      payment.expiresAt > new Date() &&
      new Decimal(payment.amount).equals(amount) &&
      !!order;
    await gateway.answerPreCheckout(
      queryId,
      valid,
      'Pesanan tidak tersedia atau pembayaran telah kedaluwarsa.',
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
