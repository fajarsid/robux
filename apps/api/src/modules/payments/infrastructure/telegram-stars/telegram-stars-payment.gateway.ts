import {
  GatewayUnavailableError,
  GatewayRejectedError,
  type GatewayPaymentCreated,
  type GatewayPaymentRequest,
  type GatewayTransactionStatus,
  type PaymentGateway,
  type RawCallback,
  type VerifiedCallback,
} from '../../domain/payment-gateway';

type FetchFunction = typeof fetch;

/** Official Bot API adapter. Production remains disabled until policy and pricing are approved. */
export class TelegramStarsPaymentGateway implements PaymentGateway {
  readonly code = 'TELEGRAM_STARS' as const;
  readonly requiresTelegramChat = true;

  constructor(
    private readonly botToken: string,
    private readonly fetchImpl: FetchFunction = fetch,
  ) {}

  enabledMethods(): readonly string[] {
    return ['TELEGRAM_STARS'];
  }

  settlementAmount(order: { total: string; currency: string; starsAmount: number | null }) {
    if (!Number.isSafeInteger(order.starsAmount) || (order.starsAmount ?? 0) <= 0) {
      throw new GatewayRejectedError('METHOD_UNAVAILABLE', 'Missing Stars quote');
    }
    return { amount: String(order.starsAmount), currency: 'XTR' };
  }

  async createPayment(request: GatewayPaymentRequest): Promise<GatewayPaymentCreated> {
    if (
      request.currency !== 'XTR' ||
      !/^\d+(?:\.00)?$/.test(request.amount) ||
      !request.telegramChatId
    ) {
      throw new GatewayRejectedError('REQUEST_REFUSED', 'Invalid Telegram Stars amount or chat');
    }
    const amount = Number(request.amount);
    if (!Number.isSafeInteger(amount) || amount <= 0)
      throw new GatewayRejectedError('REQUEST_REFUSED', 'Invalid Stars amount');
    const result = await this.post('sendInvoice', {
      chat_id: request.telegramChatId,
      title: request.description.slice(0, 32),
      description: request.description.slice(0, 255),
      payload: request.merchantOrderId,
      currency: 'XTR',
      prices: [{ label: request.description.slice(0, 32), amount }],
      // `provider_token` is intentionally omitted for digital goods paid in Stars.
    });
    const messageId = typeof result.message_id === 'number' ? result.message_id : null;
    if (!messageId) throw new GatewayUnavailableError('sendInvoice returned no message id');
    return {
      // Telegram gives the charge ID only in successful_payment. Do not confuse an invoice
      // message ID with the later payment reference used for verification.
      gatewayReference: null,
      paymentUrl: null,
      expiresAt: request.closeNoLaterThan,
    };
  }

  verifyCallback(callback: RawCallback): VerifiedCallback {
    const message = record(callback.fields.message);
    const payment = record(message?.successful_payment);
    const merchantOrderId = payment?.invoice_payload;
    const chargeId = payment?.telegram_payment_charge_id;
    const amount = payment?.total_amount;
    if (
      payment?.currency !== 'XTR' ||
      typeof merchantOrderId !== 'string' ||
      merchantOrderId.length > 80 ||
      typeof chargeId !== 'string' ||
      chargeId.length < 1 ||
      chargeId.length > 255 ||
      typeof amount !== 'number' ||
      !Number.isSafeInteger(amount) ||
      amount <= 0
    ) {
      throw new Error('Malformed Telegram Stars successful_payment update');
    }
    return {
      merchantOrderId,
      gatewayReference: chargeId,
      amount: String(amount),
      paymentMethod: 'TELEGRAM_STARS',
      eventKey: chargeId,
      payload: { currency: 'XTR', totalAmount: String(amount), chargeId, merchantOrderId },
    };
  }

  async getTransactionStatus(_merchantOrderId: string): Promise<GatewayTransactionStatus> {
    // Telegram's Bot API authenticates successful_payment updates; it has no status-by-order lookup.
    throw new GatewayUnavailableError(
      'Telegram Stars status is confirmed by successful_payment update',
    );
  }

  async answerPreCheckout(queryId: string, ok: boolean, errorMessage?: string): Promise<void> {
    await this.post(
      'answerPreCheckoutQuery',
      {
        pre_checkout_query_id: queryId,
        ok,
        ...(!ok ? { error_message: errorMessage ?? 'Pembayaran tidak dapat diproses.' } : {}),
      },
      true,
    );
  }

  private async post(
    method: string,
    body: object,
    acceptsBooleanResult = false,
  ): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.fetchImpl(`https://api.telegram.org/bot${this.botToken}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(method === 'answerPreCheckoutQuery' ? 5_000 : 10_000),
      });
    } catch {
      throw new GatewayUnavailableError(`${method} request outcome unknown`);
    }
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new GatewayUnavailableError(`${method} response unreadable`);
    }
    const result = record(value);
    if (result?.ok === false && method === 'sendInvoice') {
      throw new GatewayRejectedError('REQUEST_REFUSED', 'Telegram declined invoice creation');
    }
    if (
      !response.ok ||
      result?.ok !== true ||
      (acceptsBooleanResult ? result.result !== true : !record(result?.result))
    ) {
      throw new GatewayUnavailableError(`${method} rejected or returned an invalid response`);
    }
    return acceptsBooleanResult ? {} : (result!.result as Record<string, unknown>);
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
