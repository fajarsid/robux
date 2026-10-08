import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { PaymentGatewayCode } from '../../../../generated/prisma/enums';
import {
  CallbackRejectedError,
  type GatewayPaymentCreated,
  type GatewayPaymentRequest,
  type GatewayTransactionStatus,
  type PaymentGateway,
  type RawCallback,
  type VerifiedCallback,
} from '../../domain/payment-gateway';

type MockStatus = 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED';
type MockRecord = {
  request: GatewayPaymentRequest;
  created: GatewayPaymentCreated;
  status: MockStatus;
};

/** Development/test only. It never contacts a payment provider or represents a real payment. */
export class MockPaymentGateway implements PaymentGateway {
  readonly code: PaymentGatewayCode = 'MOCK';
  private readonly secret = randomBytes(32);
  private readonly records = new Map<string, MockRecord>();

  enabledMethods(): readonly string[] {
    return ['MK'];
  }

  async createPayment(request: GatewayPaymentRequest): Promise<GatewayPaymentCreated> {
    const previous = this.records.get(request.merchantOrderId);
    if (previous) {
      if (previous.request.amount !== request.amount || previous.request.currency !== request.currency) {
        throw new Error('Conflicting mock payment request');
      }
      return previous.created;
    }
    const created = {
      gatewayReference: `MOCK-${request.merchantOrderId}`,
      paymentUrl: `https://payment.invalid/development/${encodeURIComponent(request.merchantOrderId)}`,
      expiresAt: request.closeNoLaterThan,
    };
    this.records.set(request.merchantOrderId, { request, created, status: 'PENDING' });
    return created;
  }

  verifyCallback(raw: RawCallback): VerifiedCallback {
    const fields = raw.fields;
    const merchantOrderId = stringField(fields.merchantOrderId);
    const gatewayReference = stringField(fields.gatewayReference);
    const amount = stringField(fields.amount);
    const status = stringField(fields.status);
    const signature = stringField(fields.signature);
    if (!merchantOrderId || !gatewayReference || !amount || !status || !signature) {
      throw new CallbackRejectedError('MALFORMED');
    }
    const record = this.records.get(merchantOrderId);
    if (!record || !record.created.gatewayReference || record.created.gatewayReference !== gatewayReference) {
      throw new CallbackRejectedError('MALFORMED');
    }
    const expected = this.signature(merchantOrderId, gatewayReference, amount, status);
    if (!safeEqual(signature, expected)) throw new CallbackRejectedError('SIGNATURE_INVALID');
    return {
      merchantOrderId,
      gatewayReference,
      amount,
      paymentMethod: 'MK',
      eventKey: `${merchantOrderId}:${status}`,
      payload: { merchantOrderId, gatewayReference, amount, status },
    };
  }

  async getTransactionStatus(merchantOrderId: string): Promise<GatewayTransactionStatus> {
    const record = this.records.get(merchantOrderId);
    if (!record) throw new Error('Mock payment not found');
    const gatewayReference = record.created.gatewayReference;
    if (!gatewayReference) throw new Error('Mock payment has no provider reference');
    return {
      merchantOrderId,
      gatewayReference,
      amount: record.request.amount,
      currency: record.request.currency,
      outcome:
        record.status === 'PAID'
          ? 'PAID'
          : record.status === 'PENDING'
            ? 'PENDING'
            : 'FAILED_OR_EXPIRED',
      rawStatus: record.status,
    };
  }

  /** Called only by the local development payment control endpoint. */
  simulate(merchantOrderId: string, status: Exclude<MockStatus, 'PENDING'>): RawCallback {
    const record = this.records.get(merchantOrderId);
    if (!record) throw new Error('Mock payment not found');
    if (record.status !== 'PENDING' && record.status !== status) {
      throw new Error('Mock payment already settled');
    }
    record.status = status;
    const amount = record.request.amount;
    const reference = record.created.gatewayReference;
    if (!reference) throw new Error('Mock payment has no provider reference');
    const fields = {
      merchantOrderId,
      gatewayReference: reference,
      amount,
      status,
    };
    return {
      contentType: 'application/json',
      sourceIp: '127.0.0.1',
      fields: { ...fields, signature: this.signature(merchantOrderId, fields.gatewayReference, amount, status) },
    };
  }

  private signature(merchantOrderId: string, reference: string, amount: string, status: string) {
    return createHmac('sha256', this.secret)
      .update(`${merchantOrderId}\n${reference}\n${amount}\n${status}`)
      .digest('hex');
  }
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function safeEqual(actual: string, expected: string): boolean {
  const left = Buffer.from(actual, 'hex');
  const right = Buffer.from(expected, 'hex');
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}
