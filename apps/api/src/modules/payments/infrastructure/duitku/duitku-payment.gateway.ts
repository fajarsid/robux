import { Logger } from '@nestjs/common';
import type { DuitkuConfig } from '../../../../config/payments-config';
import {
  type GatewayPaymentCreated,
  type GatewayPaymentOutcome,
  type GatewayPaymentRequest,
  GatewayRejectedError,
  type GatewayTransactionStatus,
  GatewayUnavailableError,
  type PaymentGateway,
  type RawCallback,
  type VerifiedCallback,
} from '../../domain/payment-gateway';
import { parseDuitkuCallback } from './duitku-callback.parser';
import { duitkuExpiryMinutes, isSupportedDuitkuMethod } from './duitku-payment-methods';
import { duitkuSignature } from './duitku-signature';

const BASE_URLS = {
  sandbox: 'https://sandbox.duitku.com/webapi/api/',
  production: 'https://passport.duitku.com/webapi/api/',
} as const;

/** Check Transaction status codes (docs/integrations/duitku.md §5). */
const STATUS_OUTCOMES: Readonly<Record<string, GatewayPaymentOutcome>> = {
  '00': 'PAID',
  '01': 'PENDING',
  '02': 'FAILED_OR_EXPIRED',
};

/** Duitku rejects longer emails with HTTP 400 although the field is typed string(255). */
const MAX_EMAIL_LENGTH = 50;
const MAX_TEXT_LENGTH = 255;
const WHOLE_RUPIAH = /^(\d{1,15})(\.0{1,2})?$/;

type FetchFunction = typeof fetch;

function asText(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : null;
}

/**
 * The only code that knows Duitku endpoints, fields and signatures (ARCHITECTURE.md §6.2). Built
 * strictly from docs/integrations/duitku.md; response bodies are never logged or returned.
 */
export class DuitkuPaymentGateway implements PaymentGateway {
  readonly code = 'DUITKU' as const;
  private readonly logger = new Logger(DuitkuPaymentGateway.name);
  private readonly methods: readonly string[];

  constructor(
    private readonly config: DuitkuConfig,
    private readonly fetchImpl: FetchFunction = fetch,
  ) {
    const unsupported = config.paymentMethods.filter((code) => !isSupportedDuitkuMethod(code));
    if (unsupported.length > 0) {
      throw new Error(
        `Invalid configuration: DUITKU_PAYMENT_METHODS has unsupported codes ${unsupported.join(', ')}`,
      );
    }
    this.methods = [...new Set(config.paymentMethods)];
  }

  enabledMethods(): readonly string[] {
    return this.methods;
  }

  async createPayment(request: GatewayPaymentRequest): Promise<GatewayPaymentCreated> {
    if (!this.methods.includes(request.paymentMethod)) {
      throw new GatewayRejectedError('METHOD_UNAVAILABLE', request.paymentMethod);
    }
    const whole = WHOLE_RUPIAH.exec(request.amount);
    if (request.currency !== 'IDR' || !whole?.[1]) {
      throw new GatewayRejectedError('REQUEST_REFUSED', 'amount must be whole IDR');
    }
    if (request.customerEmail.length > MAX_EMAIL_LENGTH) {
      throw new GatewayRejectedError('REQUEST_REFUSED', 'email longer than Duitku accepts');
    }
    const allowedMinutes = Math.floor(
      (request.closeNoLaterThan.getTime() - request.now.getTime()) / 60_000,
    );
    const expiryPeriod = duitkuExpiryMinutes(request.paymentMethod, allowedMinutes);
    const paymentAmount = Number(whole[1]);
    const description = request.description.slice(0, MAX_TEXT_LENGTH);

    const body = await this.post('merchant/v2/inquiry', {
      merchantCode: this.config.merchantCode,
      paymentAmount,
      paymentMethod: request.paymentMethod,
      merchantOrderId: request.merchantOrderId,
      productDetails: description,
      email: request.customerEmail,
      customerVaName: request.orderNumber.slice(0, 20),
      itemDetails: [{ name: description, price: paymentAmount, quantity: 1 }],
      callbackUrl: this.config.callbackUrl,
      returnUrl: this.config.returnUrl,
      signature: duitkuSignature(
        this.config.apiKey,
        this.config.merchantCode,
        request.merchantOrderId,
        String(paymentAmount),
      ),
      expiryPeriod,
    });

    const reference = asText(body.reference);
    const paymentUrl = asText(body.paymentUrl);
    const qrString = asText(body.qrString);
    const echoedAmount = asText(body.amount);
    if (
      asText(body.statusCode) !== '00' ||
      !reference ||
      reference.length > MAX_TEXT_LENGTH ||
      !paymentUrl ||
      !this.isHttpsUrl(paymentUrl) ||
      (echoedAmount !== null && Number(echoedAmount) !== paymentAmount)
    ) {
      // The transaction may or may not exist at Duitku; the attempt is never shown to the customer.
      throw new GatewayUnavailableError('unexpected inquiry response');
    }
    const isQris = ['SP', 'SQ', 'NQ'].includes(request.paymentMethod);
    if (
      isQris &&
      qrString !== null &&
      (qrString.length > 4096 ||
        [...qrString].some((char) => {
          const code = char.charCodeAt(0);
          return code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31);
        }))
    ) {
      throw new GatewayUnavailableError('invalid QRIS payload');
    }
    return {
      gatewayReference: reference,
      paymentUrl,
      ...(isQris && qrString !== null ? { qrPayload: qrString } : {}),
      expiresAt: new Date(request.now.getTime() + expiryPeriod * 60_000),
    };
  }

  verifyCallback(callback: RawCallback): VerifiedCallback {
    return parseDuitkuCallback(this.config, callback);
  }

  async getTransactionStatus(merchantOrderId: string): Promise<GatewayTransactionStatus> {
    const body = await this.post('merchant/transactionStatus', {
      merchantCode: this.config.merchantCode,
      merchantOrderId,
      signature: duitkuSignature(this.config.apiKey, this.config.merchantCode, merchantOrderId),
    });
    const statusCode = asText(body.statusCode);
    const outcome = statusCode === null ? undefined : STATUS_OUTCOMES[statusCode];
    const amount = asText(body.amount);
    if (!outcome || !statusCode || amount === null) {
      throw new GatewayUnavailableError('unexpected transaction status response');
    }
    return {
      merchantOrderId: asText(body.merchantOrderId) ?? '',
      gatewayReference: asText(body.reference) ?? '',
      amount,
      // Duitku settles in rupiah only and has no currency field (docs/integrations/duitku.md §9).
      currency: 'IDR',
      outcome,
      rawStatus: statusCode,
    };
  }

  private async post(path: string, payload: object): Promise<Record<string, unknown>> {
    const operation = path.split('/').pop();
    let response: Response;
    try {
      response = await this.fetchImpl(new URL(path, BASE_URLS[this.config.environment]), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      });
    } catch (error) {
      this.logger.warn({
        event: 'payment.gateway_unreachable',
        operation,
        errorClass: 'PROVIDER_UNKNOWN',
        err: error,
      });
      throw new GatewayUnavailableError(`${operation} unreachable`);
    }
    if (response.status >= 400 && response.status < 500) {
      this.logger.warn({
        event: 'payment.gateway_refused',
        operation,
        httpStatus: response.status,
      });
      throw new GatewayRejectedError('REQUEST_REFUSED', `HTTP ${response.status}`);
    }
    if (!response.ok) {
      this.logger.warn({ event: 'payment.gateway_error', operation, httpStatus: response.status });
      throw new GatewayUnavailableError(`${operation} HTTP ${response.status}`);
    }
    try {
      const body: unknown = await response.json();
      if (body && typeof body === 'object' && !Array.isArray(body)) {
        return body as Record<string, unknown>;
      }
    } catch {
      // Fall through: an unreadable body leaves the outcome unknown.
    }
    throw new GatewayUnavailableError(`${operation} returned an unreadable body`);
  }

  private isHttpsUrl(value: string): boolean {
    try {
      return new URL(value).protocol === 'https:';
    } catch {
      return false;
    }
  }
}
