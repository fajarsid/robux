import { Inject, Injectable, Logger } from '@nestjs/common';
import { ErrorCode } from '@robux/shared';
import { createHash } from 'node:crypto';
import { DomainError } from '../../../common/errors/domain-error';
import type { RequestContext } from '../../../common/http/request-context';
import type { PaymentGatewayCode, WebhookSource } from '../../../generated/prisma/enums';
import {
  CallbackRejectedError,
  gatewayByCode,
  PAYMENT_GATEWAY,
  type PaymentGateway,
  type PaymentGatewayResolver,
  type RawCallback,
  type VerifiedCallback,
} from '../domain/payment-gateway';
import { PAYMENT_REPOSITORY, type PaymentRepository } from '../domain/payment.repository';
import {
  WEBHOOK_EVENT_REPOSITORY,
  type WebhookEventRepository,
} from '../domain/webhook-event.repository';
import { PaymentVerificationUnavailable, VerifyPaymentService } from './verify-payment.service';

const WEBHOOK_SOURCE: Readonly<Record<PaymentGatewayCode, WebhookSource>> = {
  DUITKU: 'DUITKU',
  MOCK: 'MOCK_GATEWAY',
  TELEGRAM_STARS: 'TELEGRAM_STARS',
};

export type CallbackResult = 'PROCESSED' | 'DUPLICATE' | 'UNKNOWN_PAYMENT';

function payloadHash(fields: Record<string, unknown>): string {
  const canonical = Object.keys(fields)
    .sort()
    .map((key) => [key, fields[key]]);
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/**
 * Handles a gateway callback as hostile input: authenticity first, then persistence for dedupe,
 * then verify-by-fetch. Nothing in the callback body alone can mark a payment PAID.
 */
@Injectable()
export class ProcessPaymentCallbackService {
  private readonly logger = new Logger(ProcessPaymentCallbackService.name);

  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGatewayResolver | null,
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    @Inject(WEBHOOK_EVENT_REPOSITORY) private readonly events: WebhookEventRepository,
    private readonly verification: VerifyPaymentService,
  ) {}

  async handle(
    gatewayCode: PaymentGatewayCode,
    raw: RawCallback,
    context: RequestContext,
  ): Promise<CallbackResult> {
    const gateway = gatewayByCode(this.gateway, gatewayCode);
    if (!gateway) {
      throw new DomainError(ErrorCode.NOT_FOUND, 'Data tidak ditemukan.');
    }
    const source = WEBHOOK_SOURCE[gatewayCode];
    const callback = await this.authenticate(gateway, source, raw, context);

    const event = await this.events.register({
      source,
      eventKey: callback.eventKey,
      signatureValid: true,
      payload: callback.payload,
      payloadHash: payloadHash(callback.payload),
    });
    const log = {
      requestId: context.requestId,
      webhookEventId: event.id,
      providerReference: callback.gatewayReference,
    };
    if (event.status === 'PROCESSED' || event.status === 'REJECTED') {
      this.logger.log({ event: 'payment.callback_duplicate', ...log });
      return 'DUPLICATE';
    }

    const payment = await this.payments.findByMerchantOrderId(callback.merchantOrderId);
    if (!payment || payment.gateway !== gatewayCode) {
      // Correctly signed but not ours to apply (e.g. another project sharing the key). Retrying
      // cannot help, so it is acknowledged and kept for investigation.
      await this.events.markOutcome(event.id, 'REJECTED', 'UNKNOWN_PAYMENT');
      this.logger.warn({ event: 'payment.callback_unknown_payment', ...log });
      return 'UNKNOWN_PAYMENT';
    }

    try {
      await this.verification.verify({
        payment,
        callback: { gatewayReference: callback.gatewayReference, amount: callback.amount },
        paymentMethod: callback.paymentMethod,
        requestId: context.requestId,
      });
    } catch (error) {
      await this.events.markOutcome(
        event.id,
        'FAILED',
        error instanceof PaymentVerificationUnavailable
          ? 'GATEWAY_UNAVAILABLE'
          : 'PROCESSING_ERROR',
      );
      if (error instanceof PaymentVerificationUnavailable) {
        // A non-2xx answer makes the gateway deliver the callback again later.
        throw new DomainError(
          ErrorCode.PAYMENT_GATEWAY_UNAVAILABLE,
          'Status pembayaran belum dapat diverifikasi.',
        );
      }
      throw error;
    }
    await this.events.markOutcome(event.id, 'PROCESSED');
    return 'PROCESSED';
  }

  private async authenticate(
    gateway: PaymentGateway,
    source: WebhookSource,
    raw: RawCallback,
    context: RequestContext,
  ): Promise<VerifiedCallback> {
    try {
      return gateway.verifyCallback(raw);
    } catch (error) {
      if (!(error instanceof CallbackRejectedError)) {
        throw error;
      }
      this.logger.warn({
        event: 'payment.callback_rejected',
        requestId: context.requestId,
        reason: error.rejection,
        sourceIp: context.ipAddress,
      });
      if (error.rejection === 'SIGNATURE_INVALID') {
        // Rejection record for investigation; identical forgeries collapse onto one row.
        const hash = payloadHash(raw.fields);
        const rejected = await this.events.register({
          source,
          eventKey: `rejected:${hash}`,
          signatureValid: false,
          payload: {},
          payloadHash: hash,
        });
        if (rejected.firstDelivery) {
          await this.events.markOutcome(rejected.id, 'REJECTED', 'SIGNATURE_INVALID');
        }
      }
      throw this.rejection(error);
    }
  }

  private rejection(error: CallbackRejectedError): DomainError {
    switch (error.rejection) {
      case 'MALFORMED':
        return new DomainError(ErrorCode.WEBHOOK_PAYLOAD_INVALID, 'Format data tidak valid.');
      case 'SIGNATURE_INVALID':
        return new DomainError(ErrorCode.WEBHOOK_SIGNATURE_INVALID, 'Tanda tangan tidak valid.');
      case 'SOURCE_NOT_ALLOWED':
        return new DomainError(ErrorCode.FORBIDDEN, 'Akses ditolak.');
    }
  }
}
