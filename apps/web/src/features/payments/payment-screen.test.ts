import { describe, expect, it } from 'vitest';
import { paymentScreenFor } from './payment-screen';
import { payment, paymentState } from './testing/payment-fixtures';

describe('paymentScreenFor', () => {
  it('waits while the backend reports the payment as pending', () => {
    expect(paymentScreenFor(paymentState())).toBe('pending');
  });

  it('shows success only when the backend reports the payment as paid', () => {
    expect(paymentScreenFor(paymentState({ payment: payment({ status: 'PAID' }) }))).toBe('paid');
    expect(
      paymentScreenFor(
        paymentState({ orderStage: 'PROCESSING', payment: payment({ status: 'PAID' }) }),
      ),
    ).toBe('paid');
  });

  it('maps closed attempts to their own screens', () => {
    expect(paymentScreenFor(paymentState({ payment: payment({ status: 'FAILED' }) }))).toBe(
      'failed',
    );
    expect(paymentScreenFor(paymentState({ payment: payment({ status: 'EXPIRED' }) }))).toBe(
      'expired',
    );
    expect(paymentScreenFor(paymentState({ payment: payment({ status: 'CANCELLED' }) }))).toBe(
      'cancelled',
    );
    expect(paymentScreenFor(paymentState({ payment: payment({ status: 'REFUNDED' }) }))).toBe(
      'refund',
    );
  });

  it('treats a cancelled order as closed even if an attempt still looks pending', () => {
    expect(paymentScreenFor(paymentState({ orderStage: 'CANCELLED' }))).toBe('orderCancelled');
  });

  it('offers to start a payment only when the backend allows one', () => {
    expect(paymentScreenFor(paymentState({ payment: null, canCreatePayment: true }))).toBe('start');
    expect(paymentScreenFor(paymentState({ payment: null, canCreatePayment: false }))).toBe(
      'unavailable',
    );
  });
});
