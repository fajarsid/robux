import Decimal from 'decimal.js';
import type { ReconciliationKind } from '../../../generated/prisma/enums';
import type { GatewayTransactionStatus } from './payment-gateway';

/** What we expect, from our own payment row (its amount is the order total snapshot). */
export interface ExpectedPayment {
  merchantOrderId: string;
  amount: string;
  currency: string;
  /** Known once the gateway accepted the attempt. */
  gatewayReference: string | null;
  expiresAt: Date | null;
}

/** Fields a verified callback claimed; they must agree with the fetched status. */
export interface CallbackClaim {
  gatewayReference: string;
  amount: string;
}

export type PaymentDecision =
  | { kind: 'CONFIRM_PAID'; gatewayReference: string; rawStatus: string }
  | {
      kind: 'RECONCILE';
      reconciliationKind: Extract<
        ReconciliationKind,
        'PAYMENT_AMOUNT_MISMATCH' | 'PAYMENT_STATUS_MISMATCH'
      >;
      rawStatus: string;
      evidence: Record<string, unknown>;
    }
  | { kind: 'CLOSE'; status: 'FAILED' | 'EXPIRED'; rawStatus: string }
  | { kind: 'STILL_PENDING'; rawStatus: string };

function sameAmount(a: string, b: string): boolean {
  try {
    return new Decimal(a).equals(new Decimal(b));
  } catch {
    return false;
  }
}

/**
 * Decides what a gateway status means for one payment. A payment is confirmed only when the
 * fetched status says paid AND reference, amount and currency all match what we created; any
 * disagreement goes to reconciliation and is never turned into PAID (SECURITY.md §5).
 */
export function assessGatewayStatus(
  expected: ExpectedPayment,
  observed: GatewayTransactionStatus,
  callback: CallbackClaim | null,
  now: Date,
): PaymentDecision {
  const evidence = {
    expected: {
      merchantOrderId: expected.merchantOrderId,
      amount: expected.amount,
      currency: expected.currency,
      gatewayReference: expected.gatewayReference,
    },
    observed: {
      merchantOrderId: observed.merchantOrderId,
      amount: observed.amount,
      currency: observed.currency,
      gatewayReference: observed.gatewayReference,
      outcome: observed.outcome,
      rawStatus: observed.rawStatus,
    },
    callback,
  };

  // A failed or expired attempt may come back without a reference; a paid one never may.
  const observedReference = observed.gatewayReference || null;
  const referenceMismatch =
    observed.merchantOrderId !== expected.merchantOrderId ||
    (observed.outcome === 'PAID' && observedReference === null) ||
    (observedReference !== null &&
      expected.gatewayReference !== null &&
      observedReference !== expected.gatewayReference) ||
    (observedReference !== null &&
      callback !== null &&
      callback.gatewayReference !== observedReference);
  if (referenceMismatch) {
    return {
      kind: 'RECONCILE',
      reconciliationKind: 'PAYMENT_STATUS_MISMATCH',
      rawStatus: observed.rawStatus,
      evidence: { reason: 'REFERENCE_MISMATCH', ...evidence },
    };
  }

  // A failed or expired attempt took no money, so a differing amount there changes nothing.
  const amountMismatch =
    observed.outcome !== 'FAILED_OR_EXPIRED' &&
    (observed.currency !== expected.currency ||
      !sameAmount(observed.amount, expected.amount) ||
      (callback !== null && !sameAmount(callback.amount, expected.amount)));
  if (amountMismatch) {
    return {
      kind: 'RECONCILE',
      reconciliationKind: 'PAYMENT_AMOUNT_MISMATCH',
      rawStatus: observed.rawStatus,
      evidence: { reason: 'AMOUNT_MISMATCH', ...evidence },
    };
  }

  switch (observed.outcome) {
    case 'PAID':
      return {
        kind: 'CONFIRM_PAID',
        gatewayReference: observed.gatewayReference,
        rawStatus: observed.rawStatus,
      };
    case 'PENDING':
      return { kind: 'STILL_PENDING', rawStatus: observed.rawStatus };
    case 'FAILED_OR_EXPIRED':
      return {
        kind: 'CLOSE',
        status: expected.expiresAt && expected.expiresAt <= now ? 'EXPIRED' : 'FAILED',
        rawStatus: observed.rawStatus,
      };
  }
}
