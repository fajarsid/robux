import type { PaymentDecision } from './payment-assessment';
import type { PaymentRecord } from './payment.repository';

export type PaymentDecisionOutcome =
  /** Payment and order are PAID now (one history row, one outbox event). */
  | 'CONFIRMED'
  /** Already PAID by an earlier delivery: nothing written. */
  | 'ALREADY_PAID'
  /** Money arrived but the order had left PAYMENT_PENDING (expired, cancelled): reconciliation case. */
  | 'PAID_FOR_CLOSED_ORDER'
  /** Another attempt of the same order is already PAID: reconciliation case, this one stays unpaid. */
  | 'DUPLICATE_PAYMENT'
  | 'RECONCILIATION_OPENED'
  | 'CLOSED'
  | 'UNCHANGED';

export interface ApplyPaymentDecision {
  payment: PaymentRecord;
  decision: PaymentDecision;
  /** Delivery of a gateway callback (counted on the payment) or an explicit re-check. */
  trigger: 'CALLBACK' | 'RECONCILIATION';
  paymentMethod: string | null;
  requestId?: string;
  now: Date;
}

export interface PaymentOutcomeRepository {
  /**
   * Applies a verified gateway decision atomically: payment row, order transition (through the
   * order state machine), history, outbox and reconciliation case commit or roll back together.
   */
  applyDecision(input: ApplyPaymentDecision): Promise<PaymentDecisionOutcome>;
}

export const PAYMENT_OUTCOME_REPOSITORY = Symbol('PAYMENT_OUTCOME_REPOSITORY');
