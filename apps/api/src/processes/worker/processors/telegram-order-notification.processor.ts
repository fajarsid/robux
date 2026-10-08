import { Inject, Injectable } from '@nestjs/common';
import type { JobContext, PayloadOf } from '../../../common/queue/job-definition';
import type { JobProcessor } from '../../../common/queue/job-processor';
import { PrismaService } from '../../../common/database/prisma.service';
import { TelegramBotService } from '../../../modules/telegram/telegram-bot.service';
import { ORDER_AGGREGATE, OrderEvent } from '../../../modules/orders/domain/order-events';
import {
  OUTBOX_EVENT_READER,
  type OutboxEventReader,
} from '../../../modules/outbox/domain/outbox-event.reader';
import { TELEGRAM_ORDER_NOTIFICATION_JOB } from '../../jobs/telegram-order-notification.job';

type Payload = PayloadOf<typeof TELEGRAM_ORDER_NOTIFICATION_JOB>;

@Injectable()
export class TelegramOrderNotificationProcessor implements JobProcessor<Payload> {
  readonly job = TELEGRAM_ORDER_NOTIFICATION_JOB;

  constructor(
    @Inject(OUTBOX_EVENT_READER) private readonly events: OutboxEventReader,
    private readonly prisma: PrismaService,
    private readonly bot: TelegramBotService,
  ) {}

  async process(payload: Payload, _context: JobContext): Promise<void> {
    if (!this.bot.isConfigured()) return;
    const event = await this.events.findById(payload.eventId);
    if (
      !event ||
      event.aggregateType !== ORDER_AGGREGATE ||
      event.aggregateId !== payload.aggregateId ||
      event.eventType !== payload.eventType
    )
      return;
    const state =
      event.eventType === OrderEvent.PAYMENT_CONFIRMED
        ? 'PAYMENT'
        : event.eventType === OrderEvent.FULFILLMENT_COMPLETED
          ? 'FULFILLED'
          : null;
    if (!state) return;
    const order = await this.prisma.order.findFirst({
      where: { id: event.aggregateId, telegramOrder: { isNot: null } },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        telegramOrder: {
          select: {
            paymentNotifiedAt: true,
            fulfilledNotifiedAt: true,
            identity: { select: { chatId: true } },
          },
        },
      },
    });
    if (!order?.telegramOrder) return;
    if (state === 'FULFILLED' && order.status !== 'FULFILLED') return;
    const field = state === 'PAYMENT' ? 'paymentNotifiedAt' : 'fulfilledNotifiedAt';
    if (order.telegramOrder[field] !== null) return;
    const claim = await this.prisma.telegramOrder.updateMany({
      where: { orderId: order.id, [field]: null },
      data: { [field]: new Date() },
    });
    if (claim.count !== 1) return;
    const message =
      state === 'PAYMENT'
        ? `Pembayaran untuk pesanan ${order.orderNumber} berhasil. Pesanan sedang diproses.`
        : `Pesanan ${order.orderNumber} selesai. Telegram Account Anda sudah siap.`;
    await this.bot.sendOrderNotification(
      order.telegramOrder.identity.chatId,
      message,
      this.bot.orderUrl(order.orderNumber),
    );
  }
}
