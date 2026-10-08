import {
  Body,
  Controller,
  Get,
  Headers,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ErrorCode, createOrderRequestSchema, createPaymentRequestSchema } from '@robux/shared';
import { DomainError } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/database/prisma.service';
import { requestContextOf } from '../../common/http/request-context';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { Public, SkipCsrf } from '../auth/http/auth-decorators';
import type { Request } from 'express';
import type { CreateOrderRequest } from '@robux/shared';
import { CatalogService } from '../products/application/catalog.service';
import { CreateOrderService } from '../orders/application/create-order.service';
import { DigitalAccountHandoffService } from '../orders/application/digital-account-handoff.service';
import { CreatePaymentService } from '../payments/application/create-payment.service';
import { PaymentQueriesService } from '../payments/application/payment-queries.service';
import {
  gatewayByCode,
  PAYMENT_GATEWAY,
  type PaymentGatewayResolver,
} from '../payments/domain/payment-gateway';
import { PAYMENT_REPOSITORY, type PaymentRepository } from '../payments/domain/payment.repository';
import { ProcessPaymentCallbackService } from '../payments/application/process-payment-callback.service';
import { APP_CONFIG } from '../../config/app-config.module';
import type { AppConfig } from '../../config/app-config';
import { Inject } from '@nestjs/common';
import { TelegramMiniAppAuthService } from './telegram-miniapp-auth.service';
import { TelegramBotService } from './telegram-bot.service';
import { TelegramStarsUpdateService } from './telegram-stars-update.service';

const checkoutSchema = createOrderRequestSchema.extend({
  contactEmail: z.string().email().max(254),
});
const mockOutcomeSchema = z.strictObject({ outcome: z.enum(['PAID', 'FAILED', 'EXPIRED']) });

@Public()
@Controller('telegram/miniapp')
export class TelegramMiniAppController {
  constructor(
    private readonly auth: TelegramMiniAppAuthService,
    private readonly catalog: CatalogService,
    private readonly createOrder: CreateOrderService,
    private readonly paymentCreator: CreatePaymentService,
    private readonly paymentQueries: PaymentQueriesService,
    private readonly handoff: DigitalAccountHandoffService,
    private readonly prisma: PrismaService,
    private readonly callback: ProcessPaymentCallbackService,
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGatewayResolver | null,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly bot: TelegramBotService,
  ) {}

  @Get('catalog')
  @Header('Cache-Control', 'no-store')
  @RateLimit({ name: 'telegram-catalog:ip', scope: 'ip', limit: 60, windowSeconds: 60 })
  async catalogList(@Headers('authorization') authorization?: string) {
    await this.auth.authenticate(authorization);
    return (await this.catalog.list()).filter(
      (product) => product.productLine === 'TELEGRAM_ACCOUNT',
    );
  }

  @SkipCsrf()
  @Post('orders')
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store')
  @RateLimit(
    { name: 'telegram-order-create:ip', scope: 'ip', limit: 10, windowSeconds: 600 },
    { name: 'telegram-order-create:principal', scope: 'principal', limit: 20, windowSeconds: 3600 },
  )
  async orderCreate(
    @Headers('authorization') authorization: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(checkoutSchema)) body: CreateOrderRequest,
    @Req() req: Request,
  ) {
    const identity = await this.auth.authenticate(authorization);
    const offer = await this.catalog.offerForPurchase(body.productId);
    if (offer.product.productLine !== 'TELEGRAM_ACCOUNT') {
      throw new DomainError(ErrorCode.PRODUCT_NOT_FOUND, 'Produk tidak ditemukan.');
    }
    if (
      this.config.nodeEnv === 'production' &&
      (!this.config.payments?.telegramStarsEnabled || !offer.price.starsAmount)
    ) {
      throw new DomainError(
        ErrorCode.PAYMENT_METHOD_UNAVAILABLE,
        'Produk ini belum memiliki metode pembayaran Bot yang disetujui.',
      );
    }
    const scopedKey =
      idempotencyKey && /^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)
        ? createHash('sha256').update(`${identity.id}:${idempotencyKey}`).digest('hex')
        : idempotencyKey;
    const created = await this.createOrder.create(
      body,
      scopedKey,
      undefined,
      requestContextOf(req),
    );
    const order = await this.prisma.order.findUnique({
      where: { trackingTokenHash: hashToken(created.order.trackingToken) },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        total: true,
        currency: true,
        createdAt: true,
        items: { select: { productNameSnapshot: true, quantity: true } },
      },
    });
    if (!order) throw new DomainError(ErrorCode.INTERNAL_ERROR, 'Pesanan tidak dapat dibuka.');
    await this.prisma.telegramOrder.upsert({
      where: { orderId: order.id },
      create: { orderId: order.id, telegramUserId: identity.id },
      update: {},
    });
    if (!created.replayed) {
      await this.bot.sendOrderNotification(
        identity.id,
        `Pesanan ${order.orderNumber} dibuat. Pembayaran: menunggu pembayaran.`,
      );
    }
    return safeOrder(order);
  }

  @Get('orders')
  @Header('Cache-Control', 'no-store')
  @RateLimit({ name: 'telegram-orders-list:ip', scope: 'ip', limit: 60, windowSeconds: 60 })
  async orders(@Headers('authorization') authorization?: string) {
    const identity = await this.auth.authenticate(authorization);
    const orders = await this.prisma.order.findMany({
      where: { telegramOrder: { is: { telegramUserId: identity.id } } },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        total: true,
        currency: true,
        createdAt: true,
        items: { select: { productNameSnapshot: true, quantity: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return orders.map((order) => ({
      reference: order.orderNumber,
      orderNumber: order.orderNumber,
      status: order.status,
      amount: order.total.toFixed(2),
      currency: order.currency,
      product: order.items
        .map((item) => `${item.productNameSnapshot} × ${item.quantity}`)
        .join(', '),
      createdAt: order.createdAt.toISOString(),
    }));
  }

  @Get('orders/:reference')
  @Header('Cache-Control', 'no-store')
  @RateLimit({ name: 'telegram-order-read:ip', scope: 'ip', limit: 90, windowSeconds: 60 })
  async orderGet(
    @Headers('authorization') authorization: string | undefined,
    @Param('reference') reference: string,
  ) {
    const identity = await this.auth.authenticate(authorization);
    const order = await this.prisma.order.findFirst({
      where: { orderNumber: reference, telegramOrder: { is: { telegramUserId: identity.id } } },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        total: true,
        currency: true,
        createdAt: true,
        updatedAt: true,
        items: { select: { productNameSnapshot: true, quantity: true } },
        payments: {
          select: { status: true, expiresAt: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        telegramOrder: { select: { paymentNotifiedAt: true, fulfilledNotifiedAt: true } },
      },
    });
    if (!order) throw new DomainError(ErrorCode.ORDER_NOT_FOUND, 'Pesanan tidak ditemukan.');
    if (order.payments[0]?.status === 'PAID' && order.telegramOrder?.paymentNotifiedAt === null) {
      const claimed = await this.prisma.telegramOrder.updateMany({
        where: { orderId: order.id, paymentNotifiedAt: null },
        data: { paymentNotifiedAt: new Date() },
      });
      if (claimed.count === 1) {
        await this.bot.sendOrderNotification(
          identity.id,
          `Pembayaran untuk pesanan ${order.orderNumber} berhasil. Pesanan sedang diproses.`,
        );
      }
    }
    if (order.status === 'FULFILLED' && order.telegramOrder?.fulfilledNotifiedAt === null) {
      const claimed = await this.prisma.telegramOrder.updateMany({
        where: { orderId: order.id, fulfilledNotifiedAt: null },
        data: { fulfilledNotifiedAt: new Date() },
      });
      if (claimed.count === 1) {
        await this.bot.sendOrderNotification(
          identity.id,
          `Pesanan ${order.orderNumber} selesai. Telegram Account Anda sudah siap.`,
          this.bot.orderUrl(order.orderNumber),
        );
      }
    }
    return {
      ...safeOrder(order),
      updatedAt: order.updatedAt.toISOString(),
      paymentStatus: order.payments[0]?.status ?? null,
      paymentExpiresAt: order.payments[0]?.expiresAt?.toISOString() ?? null,
      handoffAvailable: order.status === 'FULFILLED',
    };
  }

  @Get('payment-methods')
  @Header('Cache-Control', 'no-store')
  async paymentMethods(@Headers('authorization') authorization?: string) {
    await this.auth.authenticate(authorization);
    const enabled = this.paymentQueries.enabledMethods('telegram');
    // Third-party payment rails remain hidden for digital products sold inside Telegram.
    return this.config.nodeEnv === 'production'
      ? { methods: enabled.methods.filter((method) => method.code === 'TELEGRAM_STARS') }
      : enabled;
  }

  @SkipCsrf()
  @Post('orders/:reference/payment')
  @Header('Cache-Control', 'no-store')
  @RateLimit({ name: 'telegram-payment-create:ip', scope: 'ip', limit: 10, windowSeconds: 600 })
  async createPayment(
    @Headers('authorization') authorization: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('reference') reference: string,
    @Body(new ZodValidationPipe(createPaymentRequestSchema)) body: { paymentMethod: string },
    @Req() req: Request,
  ) {
    const identity = await this.auth.authenticate(authorization);
    if (this.config.nodeEnv === 'production' && body.paymentMethod !== 'TELEGRAM_STARS') {
      throw new DomainError(
        ErrorCode.PAYMENT_METHOD_UNAVAILABLE,
        'Untuk produk digital Telegram gunakan Telegram Stars.',
      );
    }
    const order = await this.ownedOrderId(identity.id, reference);
    return this.paymentCreator.create(
      { kind: 'telegram', telegramUserId: identity.id, orderId: order.id },
      body,
      idempotencyKey,
      requestContextOf(req),
    );
  }

  @Get('orders/:reference/payment')
  @Header('Cache-Control', 'no-store')
  async latestPayment(
    @Headers('authorization') authorization: string | undefined,
    @Param('reference') reference: string,
  ) {
    const identity = await this.auth.authenticate(authorization);
    const order = await this.ownedOrderId(identity.id, reference);
    return this.paymentQueries.latestForOrder({
      kind: 'telegram',
      telegramUserId: identity.id,
      orderId: order.id,
    });
  }

  @SkipCsrf()
  @Post('orders/:reference/mock-payment')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @RateLimit({ name: 'telegram-mock-payment:ip', scope: 'ip', limit: 10, windowSeconds: 600 })
  async mockPayment(
    @Headers('authorization') authorization: string | undefined,
    @Param('reference') reference: string,
    @Body(new ZodValidationPipe(mockOutcomeSchema))
    body: { outcome: 'PAID' | 'FAILED' | 'EXPIRED' },
    @Req() req: Request,
  ) {
    const identity = await this.auth.authenticate(authorization);
    const mockGateway = gatewayByCode(this.gateway, 'MOCK');
    if (
      this.config.nodeEnv === 'production' ||
      this.config.payments?.gateway !== 'mock' ||
      !mockGateway ||
      !('simulate' in mockGateway)
    ) {
      throw new DomainError(ErrorCode.NOT_FOUND, 'Data tidak ditemukan.');
    }
    const order = await this.prisma.order.findFirst({
      where: { orderNumber: reference, telegramOrder: { is: { telegramUserId: identity.id } } },
      select: { id: true, orderNumber: true },
    });
    if (!order) throw new DomainError(ErrorCode.ORDER_NOT_FOUND, 'Pesanan tidak ditemukan.');
    const payment = await this.payments.latestForOrder(order.id);
    if (!payment) throw new DomainError(ErrorCode.PAYMENT_NOT_FOUND, 'Pembayaran tidak ditemukan.');
    const raw = (
      mockGateway as typeof mockGateway & {
        simulate: (
          id: string,
          outcome: 'PAID' | 'FAILED' | 'EXPIRED',
        ) => Parameters<ProcessPaymentCallbackService['handle']>[1];
      }
    ).simulate(payment.merchantOrderId, body.outcome);
    await this.callback.handle('MOCK', raw, requestContextOf(req));
    const current = await this.prisma.order.findUnique({
      where: { id: order.id },
      select: { status: true },
    });
    return { paymentStatus: body.outcome, orderStatus: current?.status ?? 'PAYMENT_PENDING' };
  }

  @SkipCsrf()
  @Post('orders/:reference/handoff')
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @RateLimit({ name: 'telegram-handoff:ip', scope: 'ip', limit: 5, windowSeconds: 600 })
  async handoffAccount(
    @Headers('authorization') authorization: string | undefined,
    @Param('reference') reference: string,
  ) {
    const identity = await this.auth.authenticate(authorization);
    const order = await this.ownedOrderId(identity.id, reference);
    return this.handoff.forTelegram(identity.id, order.id);
  }

  private async ownedOrderId(telegramUserId: bigint, reference: string) {
    const order = await this.prisma.order.findFirst({
      where: { orderNumber: reference, telegramOrder: { is: { telegramUserId } } },
      select: { id: true },
    });
    if (!order) throw new DomainError(ErrorCode.ORDER_NOT_FOUND, 'Pesanan tidak ditemukan.');
    return order;
  }
}

@Public()
@Controller('telegram/webhook')
export class TelegramWebhookController {
  constructor(
    private readonly bot: TelegramBotService,
    private readonly stars: TelegramStarsUpdateService,
  ) {}

  @SkipCsrf()
  @Post()
  @HttpCode(HttpStatus.OK)
  @RateLimit({ name: 'telegram-webhook:ip', scope: 'ip', limit: 600, windowSeconds: 60 })
  async update(
    @Headers('x-telegram-bot-api-secret-token') secret: string | undefined,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    if (!this.bot.verifyWebhookSecret(secret))
      throw new DomainError(ErrorCode.FORBIDDEN, 'Akses ditolak.');
    const parsed = z
      .object({ update_id: z.number().int().nonnegative() })
      .passthrough()
      .safeParse(body);
    if (!parsed.success)
      throw new DomainError(ErrorCode.VALIDATION_FAILED, 'Update Telegram tidak valid.');
    await this.stars.handle(body as Record<string, unknown>, requestContextOf(req));
    await this.bot.handleUpdate(body as Parameters<TelegramBotService['handleUpdate']>[0]);
    return { ok: true };
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function safeOrder(order: {
  orderNumber: string;
  status: string;
  total: { toFixed(n: number): string } | string;
  currency: string;
  createdAt: Date;
  items: { productNameSnapshot: string; quantity: number }[];
}) {
  return {
    reference: order.orderNumber,
    orderNumber: order.orderNumber,
    product: order.items.map((item) => `${item.productNameSnapshot} × ${item.quantity}`).join(', '),
    status: order.status,
    amount: typeof order.total === 'string' ? order.total : order.total.toFixed(2),
    currency: order.currency,
    createdAt: order.createdAt.toISOString(),
  };
}
