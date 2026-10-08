import type { PaymentGatewayCode, PaymentStatus } from '../../../generated/prisma/enums';
import type { GatewayPaymentCreated } from './payment-gateway';

export interface PaymentRecord {
  id: string;
  orderId: string;
  gateway: PaymentGatewayCode;
  merchantOrderId: string;
  gatewayReference: string | null;
  paymentMethod: string | null;
  amount: string;
  currency: string;
  status: PaymentStatus;
  paymentUrl: string | null;
  qrPayload?: string | null;
  expiresAt: Date | null;
  paidAt: Date | null;
  createdAt: Date;
}

export interface NewPaymentAttempt {
  orderId: string;
  gateway: PaymentGatewayCode;
  merchantOrderId: string;
  paymentMethod: string;
  amount: string;
  currency: string;
}

export interface PaymentIdempotencyRecord {
  scope: string;
  key: string;
  requestHash: string;
  response: Record<string, unknown>;
  expiresAt: Date;
}

/** Another attempt for the order was opened concurrently (one PENDING attempt per order). */
export class PaymentAttemptConflict extends Error {
  constructor() {
    super('A payment attempt for this order is already open');
    this.name = 'PaymentAttemptConflict';
  }
}

export interface PaymentRepository {
  latestForOrder(orderId: string): Promise<PaymentRecord | null>;
  findOpenAttempt(orderId: string): Promise<PaymentRecord | null>;
  countAttempts(orderId: string): Promise<number>;
  findByMerchantOrderId(merchantOrderId: string): Promise<PaymentRecord | null>;
  /** Inserts a PENDING attempt; throws PaymentAttemptConflict if one is already open. */
  openAttempt(attempt: NewPaymentAttempt): Promise<PaymentRecord>;
  /** Stores what the gateway returned and the replayable response, in one transaction. */
  recordGatewayAcceptance(
    paymentId: string,
    created: GatewayPaymentCreated,
    idempotency: PaymentIdempotencyRecord,
  ): Promise<void>;
  /** PENDING → FAILED/EXPIRED; false if the attempt was no longer PENDING. */
  closeAttempt(
    paymentId: string,
    status: 'FAILED' | 'EXPIRED',
    rawStatus: string,
  ): Promise<boolean>;
  findIdempotentResponse(
    scope: string,
    key: string,
  ): Promise<{ requestHash: string; response: Record<string, unknown> } | null>;
}

export const PAYMENT_REPOSITORY = Symbol('PAYMENT_REPOSITORY');
