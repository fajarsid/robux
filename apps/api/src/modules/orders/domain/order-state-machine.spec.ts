import { ORDER_STATUSES } from '@robux/shared';
import { DomainError } from '../../../common/errors/domain-error';
import { OrderStatus } from '../../../generated/prisma/enums';
import {
  allTransitions,
  assertTransition,
  canTransition,
  hasEnteredFulfillment,
  isCancellable,
} from './order-state-machine';

const ALL_STATUSES = Object.values(OrderStatus);

describe('order state machine', () => {
  it('lets a new order wait for payment and lets an unpaid order be cancelled', () => {
    expect(canTransition('CREATED', 'PAYMENT_PENDING')).toBe(true);
    expect(canTransition('CREATED', 'CANCELLED')).toBe(true);
    expect(canTransition('PAYMENT_PENDING', 'CANCELLED')).toBe(true);
  });

  it('only lets customers and staff cancel before payment', () => {
    expect(ALL_STATUSES.filter(isCancellable).sort()).toEqual(['CREATED', 'PAYMENT_PENDING']);
    for (const status of ['PAID', 'QUEUED', 'PROCESSING', 'FULFILLED', 'REFUNDED'] as const) {
      expect(isCancellable(status)).toBe(false);
      expect(canTransition(status, 'CANCELLED')).toBe(false);
    }
  });

  it('treats CANCELLED and REFUNDED as terminal', () => {
    for (const to of ALL_STATUSES) {
      expect(canTransition('CANCELLED', to)).toBe(false);
      expect(canTransition('REFUNDED', to)).toBe(false);
    }
  });

  it('never skips payment: only PAYMENT_PENDING or reconciliation reach PAID', () => {
    const intoPaid = allTransitions()
      .filter(([, to]) => to === 'PAID')
      .map(([from]) => from);
    expect(intoPaid.sort()).toEqual(['PAYMENT_PENDING', 'RECONCILIATION_REQUIRED']);
    expect(canTransition('CREATED', 'PAID')).toBe(false);
    expect(canTransition('PAYMENT_PENDING', 'FULFILLED')).toBe(false);
  });

  it('has no self transitions', () => {
    for (const [from, to] of allTransitions()) {
      expect(from).not.toBe(to);
    }
  });

  it('throws INVALID_ORDER_TRANSITION for a forbidden transition', () => {
    expect(() => assertTransition('CREATED', 'PAYMENT_PENDING')).not.toThrow();
    let caught: unknown;
    try {
      assertTransition('CANCELLED', 'PAYMENT_PENDING');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DomainError);
    expect((caught as DomainError).code).toBe('INVALID_ORDER_TRANSITION');
  });
});

describe('shared order status contract', () => {
  it('lists exactly the database order statuses, so web and API share one definition', () => {
    expect([...ORDER_STATUSES].sort()).toEqual([...ALL_STATUSES].sort());
  });
});

describe('hasEnteredFulfillment', () => {
  it('is true from QUEUED onwards and false before payment or outside the fulfillment path', () => {
    expect(ALL_STATUSES.filter(hasEnteredFulfillment).sort()).toEqual(
      [
        'QUEUED',
        'PROCESSING',
        'FULFILLMENT_PENDING',
        'FULFILLED',
        'FAILED',
        'RETRYING',
        'PARTIALLY_FULFILLED',
        'FAILED_PERMANENTLY',
      ].sort(),
    );
    expect(canTransition('PAID', 'QUEUED')).toBe(true);
  });
});
