import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type CreatePaymentRequest,
  ErrorCode,
  IDEMPOTENCY_KEY_PATTERN,
  type PaymentView,
} from '@robux/shared';
import { createHash } from 'node:crypto';
import { DomainError } from '../../../common/errors/domain-error';
import type { RequestContext } from '../../../common/http/request-context';
import { PayableOrderService } from '../../orders/application/payable-order.service';
import {
  GatewayRejectedError,
  GatewayUnavailableError,
  PAYMENT_GATEWAY,
  gatewayForMethod,
  type PaymentGatewayResolver,
} from '../domain/payment-gateway';
import {
  PAYMENT_REPOSITORY,
  PaymentAttemptConflict,
  type PaymentRecord,
  type PaymentRepository,
} from '../domain/payment.repository';
import { gatewayCloseDeadline } from '../domain/payment-window';
import { type PaymentOrderAccess, resolvePayableOrder } from './payment-order-access';
import { toPaymentView } from './payment-views';

/** REUSED: the order's live attempt with the same method was handed back unchanged. */
export type PaymentCreationOutcome = 'CREATED' | 'REPLAYED' | 'REUSED';

const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60_000;

/**
 * An attempt without a payment link older than this was abandoned mid-creation (crash or gateway
 * timeout after our insert). The customer never received its link, so it is safe to close.
 */
const ABANDONED_CREATION_MS = 2 * 60_000;

const gatewayUnavailable = () =>
  new DomainError(
    ErrorCode.PAYMENT_GATEWAY_UNAVAILABLE,
    'Layanan pembayaran sedang tidak tersedia. Silakan coba lagi.',
  );

const paymentInProgress = () =>
  new DomainError(
    ErrorCode.PAYMENT_IN_PROGRESS,
    'Pembayaran sedang disiapkan. Silakan coba lagi sebentar.',
  );

/**
 * Opens (or returns) the payment attempt of an order. The amount is the order's stored total,
 * never a client value; one live attempt per order prevents paying twice.
 */
@Injectable()
export class CreatePaymentService {
  private readonly logger = new Logger(CreatePaymentService.name);

  constructor(
    private readonly orders: PayableOrderService,
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGatewayResolver | null,
  ) {}

  async create(
    access: PaymentOrderAccess,
    request: CreatePaymentRequest,
    idempotencyKey: string | undefined,
    context: RequestContext,
    now = new Date(),
  ): Promise<{ payment: PaymentView; outcome: PaymentCreationOutcome }> {
    if (!idempotencyKey || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      throw new DomainError(
        ErrorCode.IDEMPOTENCY_KEY_REQUIRED,
        'Header Idempotency-Key wajib diisi (16–128 karakter acak).',
      );
    }
    const order = await resolvePayableOrder(this.orders, access);
    const scope = `payments.create:${order.id}`;
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ paymentMethod: request.paymentMethod }))
      .digest('hex');
    const stored = await this.payments.findIdempotentResponse(scope, idempotencyKey);
    if (stored) {
      if (stored.requestHash !== requestHash) {
        throw new DomainError(
          ErrorCode.DUPLICATE_IDEMPOTENCY_KEY,
          'Idempotency-Key ini sudah dipakai untuk pembayaran yang berbeda.',
        );
      }
      return { payment: stored.response as unknown as PaymentView, outcome: 'REPLAYED' };
    }

    if (!this.gateway) {
      throw gatewayUnavailable();
    }
    const gateway = gatewayForMethod(this.gateway, request.paymentMethod);
    if (!gateway) {
      throw new DomainError(
        ErrorCode.PAYMENT_METHOD_UNAVAILABLE,
        'Metode pembayaran ini tidak tersedia.',
      );
    }
    if (gateway.requiresTelegramChat && access.kind !== 'telegram') {
      throw new DomainError(
        ErrorCode.PAYMENT_METHOD_UNAVAILABLE,
        'Metode ini hanya tersedia di Telegram.',
      );
    }
    if (order.status !== 'PAYMENT_PENDING') {
      throw new DomainError(
        ErrorCode.ORDER_NOT_PAYABLE,
        'Pesanan ini tidak dapat dibayar pada status saat ini.',
      );
    }
    let settlement = { amount: order.total, currency: order.currency };
    if (gateway.settlementAmount) {
      try {
        settlement = gateway.settlementAmount({
          total: order.total,
          currency: order.currency,
          starsAmount: order.starsAmount ?? null,
        });
      } catch (error) {
        if (error instanceof GatewayRejectedError) {
          throw new DomainError(
            ErrorCode.PAYMENT_METHOD_UNAVAILABLE,
            'Metode pembayaran ini tidak tersedia.',
          );
        }
        throw error;
      }
    }
    const closeBy = gatewayCloseDeadline(order.paymentExpiresAt, now);
    if (!closeBy) {
      throw new DomainError(
        ErrorCode.ORDER_NOT_PAYABLE,
        'Batas waktu pembayaran pesanan ini hampir habis.',
      );
    }

    const open = await this.payments.findOpenAttempt(order.id);
    if (open) {
      const reusable = await this.settleOpenAttempt(open, request.paymentMethod, now);
      if (reusable) {
        return { payment: toPaymentView(reusable, now), outcome: 'REUSED' };
      }
    }

    let attempt: PaymentRecord;
    try {
      attempt = await this.payments.openAttempt({
        orderId: order.id,
        gateway: gateway.code,
        merchantOrderId: `${order.orderNumber}-${(await this.payments.countAttempts(order.id)) + 1}`,
        paymentMethod: request.paymentMethod,
        amount: settlement.amount,
        currency: settlement.currency,
      });
    } catch (error) {
      if (error instanceof PaymentAttemptConflict) {
        throw paymentInProgress();
      }
      throw error;
    }

    const logContext = {
      requestId: context.requestId,
      orderId: order.id,
      paymentId: attempt.id,
      paymentMethod: request.paymentMethod,
    };
    try {
      const created = await gateway.createPayment({
        merchantOrderId: attempt.merchantOrderId,
        amount: attempt.amount,
        currency: attempt.currency,
        telegramChatId: access.kind === 'telegram' ? access.telegramUserId.toString() : null,
        paymentMethod: request.paymentMethod,
        customerEmail: order.contactEmail,
        orderNumber: order.orderNumber,
        description: order.description,
        closeNoLaterThan: closeBy,
        now,
      });
      const view = toPaymentView({ ...attempt, ...created }, now);
      await this.payments.recordGatewayAcceptance(attempt.id, created, {
        scope,
        key: idempotencyKey,
        requestHash,
        response: view as unknown as Record<string, unknown>,
        expiresAt: new Date(now.getTime() + IDEMPOTENCY_WINDOW_MS),
      });
      this.logger.log({
        event: 'payment.created',
        ...logContext,
        providerReference: created.gatewayReference,
      });
      return { payment: view, outcome: 'CREATED' };
    } catch (error) {
      // A timeout can happen after the provider accepted the request. Keep the attempt open so
      // retries cannot create a second invoice/payment; callbacks/reconciliation can resolve it.
      if (!(error instanceof GatewayUnavailableError) || gateway.code !== 'TELEGRAM_STARS') {
        await this.payments.closeAttempt(attempt.id, 'FAILED', 'CREATION_FAILED');
      }
      throw this.creationFailure(error, logContext);
    }
  }

  /**
   * Decides what to do with the order's open attempt: hand it back when it is the same method
   * and still payable, close it when it is dead, refuse otherwise (a second live attempt could
   * be paid as well).
   */
  private async settleOpenAttempt(
    open: PaymentRecord,
    paymentMethod: string,
    now: Date,
  ): Promise<PaymentRecord | null> {
    if (open.paymentUrl === null) {
      if (open.gateway === 'TELEGRAM_STARS' && open.paymentMethod === paymentMethod) return open;
      if (now.getTime() - open.createdAt.getTime() < ABANDONED_CREATION_MS) {
        throw paymentInProgress();
      }
      await this.payments.closeAttempt(open.id, 'FAILED', 'CREATION_ABANDONED');
      return null;
    }
    if (open.expiresAt !== null && open.expiresAt <= now) {
      await this.payments.closeAttempt(open.id, 'EXPIRED', 'EXPIRED_BY_DEADLINE');
      return null;
    }
    if (open.paymentMethod === paymentMethod) {
      return open;
    }
    throw new DomainError(
      ErrorCode.PAYMENT_ALREADY_PENDING,
      'Masih ada pembayaran aktif untuk pesanan ini. Selesaikan atau tunggu hingga kedaluwarsa.',
    );
  }

  private creationFailure(error: unknown, logContext: Record<string, unknown>): Error {
    if (error instanceof GatewayRejectedError) {
      this.logger.warn({
        event: 'payment.creation_rejected',
        ...logContext,
        reason: error.reason,
        errorClass: 'PROVIDER_PERMANENT',
      });
      return error.reason === 'REQUEST_REFUSED'
        ? new DomainError(
            ErrorCode.PAYMENT_GATEWAY_REJECTED,
            'Pembayaran tidak dapat dibuat. Silakan pilih metode lain atau coba lagi.',
          )
        : new DomainError(
            ErrorCode.PAYMENT_METHOD_UNAVAILABLE,
            'Metode pembayaran ini tidak tersedia untuk sisa waktu pesanan.',
          );
    }
    if (error instanceof GatewayUnavailableError) {
      this.logger.warn({
        event: 'payment.creation_unknown',
        ...logContext,
        errorClass: 'PROVIDER_UNKNOWN',
      });
      return gatewayUnavailable();
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}
