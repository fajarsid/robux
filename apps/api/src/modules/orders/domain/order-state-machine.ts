import { ErrorCode } from '@robux/shared';
import { DomainError } from '../../../common/errors/domain-error';
import type { OrderStatus } from '../../../generated/prisma/enums';

/**
 * Every allowed order transition (ARCHITECTURE.md §5.3, PRD §12). Anything not listed is
 * rejected. Phase 5 uses CREATED → PAYMENT_PENDING and the cancellations; the remaining rows are
 * exercised by the payment, fulfillment and refund phases.
 */
const TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  CREATED: ['PAYMENT_PENDING', 'CANCELLED'],
  PAYMENT_PENDING: ['PAID', 'CANCELLED', 'RECONCILIATION_REQUIRED'],
  PAID: ['QUEUED', 'REFUND_PENDING'],
  QUEUED: ['PROCESSING', 'REFUND_PENDING'],
  PROCESSING: ['FULFILLMENT_PENDING', 'FAILED', 'PARTIALLY_FULFILLED', 'RECONCILIATION_REQUIRED'],
  FULFILLMENT_PENDING: ['FULFILLED', 'PARTIALLY_FULFILLED', 'FAILED', 'RECONCILIATION_REQUIRED'],
  FAILED: ['RETRYING', 'FAILED_PERMANENTLY'],
  RETRYING: ['PROCESSING'],
  PARTIALLY_FULFILLED: ['RETRYING', 'FAILED_PERMANENTLY', 'REFUND_PENDING'],
  FAILED_PERMANENTLY: ['RETRYING', 'REFUND_PENDING'],
  RECONCILIATION_REQUIRED: ['FULFILLED', 'PARTIALLY_FULFILLED', 'FAILED', 'PAID', 'CANCELLED'],
  REFUND_PENDING: ['REFUNDED'],
  // FULFILLED → REFUND_PENDING exists only as the SUPER_ADMIN exception (payments.refund).
  FULFILLED: ['REFUND_PENDING'],
  CANCELLED: [],
  REFUNDED: [],
};

/**
 * Cancellation is allowed only before any money has been taken. After payment the path is a
 * refund (Phase 13), never a cancellation.
 */
export const CANCELLABLE_STATUSES: readonly OrderStatus[] = ['CREATED', 'PAYMENT_PENDING'];

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) {
    throw new DomainError(
      ErrorCode.INVALID_ORDER_TRANSITION,
      `Status pesanan tidak dapat berubah dari ${from} ke ${to}.`,
    );
  }
}

export function isCancellable(status: OrderStatus): boolean {
  return CANCELLABLE_STATUSES.includes(status);
}

/** Statuses an order reaches only after it was handed to fulfillment (PAID → QUEUED and on). */
const FULFILLMENT_STATUSES: readonly OrderStatus[] = [
  'QUEUED',
  'PROCESSING',
  'FULFILLMENT_PENDING',
  'FULFILLED',
  'FAILED',
  'RETRYING',
  'PARTIALLY_FULFILLED',
  'FAILED_PERMANENTLY',
];

export function hasEnteredFulfillment(status: OrderStatus): boolean {
  return FULFILLMENT_STATUSES.includes(status);
}

export function allTransitions(): readonly [OrderStatus, OrderStatus][] {
  return (Object.keys(TRANSITIONS) as OrderStatus[]).flatMap((from) =>
    TRANSITIONS[from].map((to) => [from, to] as [OrderStatus, OrderStatus]),
  );
}
