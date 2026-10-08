import type { PaymentGatewayCode } from '../../../generated/prisma/enums';

/**
 * Gateway-neutral port (ARCHITECTURE.md §6.2). Adapters translate to and from their provider's
 * contract; nothing here knows a provider's field names, codes or signature rules.
 */
export interface PaymentGateway {
  readonly code: PaymentGatewayCode;
  readonly requiresTelegramChat?: boolean;
  /** Method codes this deployment accepts (enabled in configuration and supported by the adapter). */
  enabledMethods(): readonly string[];
  createPayment(request: GatewayPaymentRequest): Promise<GatewayPaymentCreated>;
  /** Checks shape, merchant and signature only. The result is a trigger, not proof of payment. */
  verifyCallback(callback: RawCallback): VerifiedCallback;
  /** Authoritative status, fetched from the gateway by our own authenticated request. */
  getTransactionStatus(merchantOrderId: string): Promise<GatewayTransactionStatus>;
  /** Provider-specific settlement amount. The order remains priced and snapshotted in IDR. */
  settlementAmount?(order: { total: string; currency: string; starsAmount: number | null }): {
    amount: string;
    currency: string;
  };
  answerPreCheckout?(queryId: string, ok: boolean, errorMessage?: string): Promise<void>;
}

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

/** Resolves providers by the selected customer-facing method and by persisted provider code. */
export interface PaymentGatewayRegistry {
  enabledMethods(): readonly string[];
  forMethod(method: string): PaymentGateway | null;
  byCode(code: PaymentGatewayCode): PaymentGateway | null;
}

export type PaymentGatewayResolver = PaymentGateway | PaymentGatewayRegistry;

export function gatewayForMethod(
  resolver: PaymentGatewayResolver | null,
  method: string,
): PaymentGateway | null {
  if (!resolver) return null;
  if ('forMethod' in resolver) return resolver.forMethod(method);
  return resolver.enabledMethods().includes(method) ? resolver : null;
}

export function gatewayByCode(
  resolver: PaymentGatewayResolver | null,
  code: PaymentGatewayCode,
): PaymentGateway | null {
  if (!resolver) return null;
  if ('byCode' in resolver) return resolver.byCode(code);
  return resolver.code === code ? resolver : null;
}

/** Rejects ambiguous method codes at startup instead of silently changing payment routing. */
export class ConfiguredPaymentGatewayRegistry implements PaymentGatewayRegistry {
  private readonly methods = new Map<string, PaymentGateway>();
  private readonly providers = new Map<PaymentGatewayCode, PaymentGateway>();

  constructor(gateways: readonly PaymentGateway[]) {
    for (const gateway of gateways) {
      if (this.providers.has(gateway.code))
        throw new Error(`Duplicate payment gateway: ${gateway.code}`);
      this.providers.set(gateway.code, gateway);
      for (const method of gateway.enabledMethods()) {
        if (this.methods.has(method)) throw new Error(`Duplicate payment method: ${method}`);
        this.methods.set(method, gateway);
      }
    }
  }

  enabledMethods(): readonly string[] {
    return [...this.methods.keys()];
  }

  forMethod(method: string): PaymentGateway | null {
    return this.methods.get(method) ?? null;
  }

  byCode(code: PaymentGatewayCode): PaymentGateway | null {
    return this.providers.get(code) ?? null;
  }
}

export interface GatewayPaymentRequest {
  merchantOrderId: string;
  /** Decimal string, exactly the stored payment amount. */
  amount: string;
  currency: string;
  telegramChatId?: string | null;
  paymentMethod: string;
  customerEmail: string;
  orderNumber: string;
  description: string;
  /** The attempt must close by then; adapters shorten it to what the method allows. */
  closeNoLaterThan: Date;
  now: Date;
}

export interface GatewayPaymentCreated {
  /** Null until the provider gives us an authoritative transaction reference. */
  gatewayReference: string | null;
  paymentUrl: string | null;
  /** Customer-safe machine-readable QR payment payload, only for the paying order owner. */
  qrPayload?: string | null;
  /** When the gateway stops accepting payment for this attempt. */
  expiresAt: Date;
}

/** Internal reading of the gateway status. FAILED_OR_EXPIRED is one state because gateways may not tell them apart. */
export type GatewayPaymentOutcome = 'PAID' | 'PENDING' | 'FAILED_OR_EXPIRED';

export interface GatewayTransactionStatus {
  merchantOrderId: string;
  gatewayReference: string;
  amount: string;
  currency: string;
  outcome: GatewayPaymentOutcome;
  /** The provider code exactly as reported, kept for support and reconciliation. */
  rawStatus: string;
}

export interface RawCallback {
  contentType: string | undefined;
  fields: Record<string, unknown>;
  sourceIp: string;
}

export interface VerifiedCallback {
  merchantOrderId: string;
  gatewayReference: string;
  amount: string;
  paymentMethod: string | null;
  /** Unique per gateway notification; repeated deliveries of one notification share it. */
  eventKey: string;
  /** Fields worth keeping, without signature or customer personal data. */
  payload: Record<string, string>;
}

export type CallbackRejection = 'MALFORMED' | 'SIGNATURE_INVALID' | 'SOURCE_NOT_ALLOWED';

export class CallbackRejectedError extends Error {
  constructor(readonly rejection: CallbackRejection) {
    super(`Payment callback rejected: ${rejection}`);
    this.name = 'CallbackRejectedError';
  }
}

/** The gateway definitely refused the request; nothing was created. */
export class GatewayRejectedError extends Error {
  constructor(
    readonly reason: 'METHOD_UNAVAILABLE' | 'WINDOW_TOO_SHORT' | 'REQUEST_REFUSED',
    readonly detail?: string,
  ) {
    super(`Payment gateway rejected the request: ${reason}`);
    this.name = 'GatewayRejectedError';
  }
}

/** The outcome is unknown: timeout, network error, 5xx or an unreadable response. */
export class GatewayUnavailableError extends Error {
  constructor(readonly detail: string) {
    super(`Payment gateway unavailable: ${detail}`);
    this.name = 'GatewayUnavailableError';
  }
}
