import type { PaymentView } from '@robux/shared';
import type { PaymentRecord } from '../domain/payment.repository';

/** Customer view of an attempt; the payment link is offered only while it can still be paid. */
export function toPaymentView(payment: PaymentRecord, now: Date): PaymentView {
  const payable =
    payment.status === 'PENDING' &&
    payment.paymentUrl !== null &&
    payment.expiresAt !== null &&
    payment.expiresAt > now;
  return {
    status: payment.status,
    paymentMethod: payment.paymentMethod,
    amount: payment.amount,
    currency: payment.currency,
    paymentUrl: payable ? payment.paymentUrl : null,
    paymentQrPayload: payable ? (payment.qrPayload ?? null) : null,
    expiresAt: payment.expiresAt?.toISOString() ?? null,
    paidAt: payment.paidAt?.toISOString() ?? null,
  };
}
