import { PAYMENT_STATUSES } from '@robux/shared';
import { PaymentStatus } from '../../../generated/prisma/enums';
import { assessGatewayStatus, type ExpectedPayment } from './payment-assessment';
import type { GatewayTransactionStatus } from './payment-gateway';

const now = new Date('2026-10-05T10:00:00Z');

const expected: ExpectedPayment = {
  merchantOrderId: 'RBX-20261005-00001-1',
  amount: '138000.00',
  currency: 'IDR',
  gatewayReference: 'DREF1',
  expiresAt: new Date('2026-10-05T10:30:00Z'),
};

function observed(overrides: Partial<GatewayTransactionStatus> = {}): GatewayTransactionStatus {
  return {
    merchantOrderId: expected.merchantOrderId,
    gatewayReference: 'DREF1',
    amount: '138000',
    currency: 'IDR',
    outcome: 'PAID',
    rawStatus: '00',
    ...overrides,
  };
}

describe('assessGatewayStatus', () => {
  it('confirms a paid status whose reference, amount and currency all match', () => {
    expect(
      assessGatewayStatus(
        expected,
        observed(),
        { gatewayReference: 'DREF1', amount: '138000' },
        now,
      ),
    ).toEqual({ kind: 'CONFIRM_PAID', gatewayReference: 'DREF1', rawStatus: '00' });
  });

  it.each([
    ['gateway amount', observed({ amount: '137999' }), null],
    ['callback amount', observed(), { gatewayReference: 'DREF1', amount: '1000' }],
    ['currency', observed({ currency: 'USD' }), null],
    ['unparseable amount', observed({ amount: 'abc' }), null],
  ])('sends a %s mismatch to reconciliation', (_name, status, callback) => {
    expect(assessGatewayStatus(expected, status, callback, now)).toMatchObject({
      kind: 'RECONCILE',
      reconciliationKind: 'PAYMENT_AMOUNT_MISMATCH',
    });
  });

  it.each([
    ['merchant order id', observed({ merchantOrderId: 'RBX-20261005-00002-1' }), null],
    ['stored reference', observed({ gatewayReference: 'DREF2' }), null],
    ['callback reference', observed(), { gatewayReference: 'DREF9', amount: '138000' }],
    ['missing reference on a paid status', observed({ gatewayReference: '' }), null],
  ])('sends a %s mismatch to reconciliation', (_name, status, callback) => {
    expect(assessGatewayStatus(expected, status, callback, now)).toMatchObject({
      kind: 'RECONCILE',
      reconciliationKind: 'PAYMENT_STATUS_MISMATCH',
    });
  });

  it('keeps a pending status pending', () => {
    expect(
      assessGatewayStatus(expected, observed({ outcome: 'PENDING', rawStatus: '01' }), null, now),
    ).toEqual({
      kind: 'STILL_PENDING',
      rawStatus: '01',
    });
  });

  it('closes a failed attempt as FAILED before its deadline and EXPIRED after it', () => {
    const failed = observed({
      outcome: 'FAILED_OR_EXPIRED',
      rawStatus: '02',
      gatewayReference: '',
      amount: '0',
    });
    expect(assessGatewayStatus(expected, failed, null, now)).toEqual({
      kind: 'CLOSE',
      status: 'FAILED',
      rawStatus: '02',
    });
    expect(assessGatewayStatus(expected, failed, null, new Date('2026-10-05T11:00:00Z'))).toEqual({
      kind: 'CLOSE',
      status: 'EXPIRED',
      rawStatus: '02',
    });
  });
});

describe('shared payment status contract', () => {
  it('lists exactly the database payment statuses', () => {
    expect([...PAYMENT_STATUSES].sort()).toEqual(Object.values(PaymentStatus).sort());
  });
});
