import type {
  FulfillmentAttemptStatus,
  FulfillmentOrderStatus,
  OrderStatus,
} from '../../../generated/prisma/enums';
import { OrderEvent } from '../../orders/domain/order-events';
import type { DeliveryResolution, FulfillmentFailureCode } from './delivery-resolution';

/** Why the workflow stopped without delivering everything. */
export type FulfillmentStopReason =
  | FulfillmentFailureCode
  /** Automatic retries are used up; the last failure is kept alongside. */
  | 'RETRY_EXHAUSTED'
  /** Still unknown when the job ran out of runs; a person or reconciliation must decide. */
  | 'VERIFICATION_INCONCLUSIVE';

export interface PlannedTransition {
  from: OrderStatus;
  to: OrderStatus;
  /** Outbox event announced with this transition, if any. */
  event?: string;
  reason: string;
}

/**
 * FULFILLED, FAILED_PERMANENTLY, RECONCILIATION_REQUIRED: the workflow is over (for now).
 * RETRY_SCHEDULED: nothing was delivered for the remaining amount; run again after the backoff.
 * AWAITING_VERIFICATION: the outcome is unknown or pending; verify after the backoff.
 * NEXT_ALLOCATION: this allocation was delivered in full and another one of the same plan is
 *   still open; the same run executes it (no order transition, the order stays PROCESSING).
 */
export type PlanOutcome =
  | 'FULFILLED'
  | 'NEXT_ALLOCATION'
  | 'FAILED_PERMANENTLY'
  | 'RECONCILIATION_REQUIRED'
  | 'RETRY_SCHEDULED'
  | 'AWAITING_VERIFICATION';

export interface FulfillmentPlan {
  transitions: PlannedTransition[];
  /** New status of the attempt that produced the resolution (absent when no attempt was made). */
  attemptStatus: FulfillmentAttemptStatus | null;
  deliveredAmount: number;
  fulfillmentOrderStatus: FulfillmentOrderStatus;
  outcome: PlanOutcome;
  stopReason: FulfillmentStopReason | null;
  /**
   * Reserved inventory to give back (ADR-007): CURRENT = the allocation this step used (a source
   * that did not deliver; the remainder is routed again), ALL = every open allocation (the
   * workflow is over). Unknown or pending outcomes and partial deliveries keep their reservation.
   */
  releaseAllocations: 'NONE' | 'CURRENT' | 'ALL';
}

export interface PlanInput {
  /** Where the order is while a request is being executed or verified. */
  orderStatus: 'PROCESSING' | 'FULFILLMENT_PENDING';
  fulfilledAmount: number;
  remainingAmount: number;
  /** Requested amount of the attempt being resolved, or null for a failure before any attempt. */
  attemptRequestedAmount: number | null;
  resolution: DeliveryResolution;
  /** Automatic retries already scheduled for this order (transitions to RETRYING). */
  retriesUsed: number;
  /** Runs allowed in total, from the job's retry policy. */
  maxAttempts: number;
  /** The job has no run left after this one: nothing may be left waiting for a retry. */
  finalRun: boolean;
}

const REASONS = {
  pending: 'Pengiriman diproses penyedia; menunggu verifikasi',
  completed: 'Seluruh Robux terkirim',
  partial: 'Sebagian Robux terkirim; sisanya dikirim ulang',
  failed: 'Pengiriman gagal',
  retrying: 'Pengiriman dijadwalkan ulang',
  permanentlyFailed: 'Pengiriman gagal permanen',
  exhausted: 'Batas percobaan otomatis tercapai',
  inconclusive: 'Hasil pengiriman belum dapat dipastikan; perlu rekonsiliasi',
} as const;

/**
 * Turns one resolution into the order transitions, attempt status and amounts to commit together.
 * Pure: the transition table in the orders domain still validates every step when it is written.
 */
export function planFulfillment(input: PlanInput): FulfillmentPlan {
  const { resolution, orderStatus } = input;
  const exhausted = input.finalRun || input.retriesUsed >= input.maxAttempts - 1;

  if (resolution.kind === 'DELIVERED') {
    const delivered = resolution.fulfilledAmount;
    const attemptStatus =
      input.attemptRequestedAmount !== null && delivered < input.attemptRequestedAmount
        ? 'PARTIAL'
        : 'SUCCEEDED';
    if (
      delivered < input.remainingAmount &&
      attemptStatus === 'SUCCEEDED' &&
      orderStatus === 'PROCESSING'
    ) {
      return {
        transitions: [],
        attemptStatus,
        deliveredAmount: delivered,
        fulfillmentOrderStatus: 'IN_PROGRESS',
        outcome: 'NEXT_ALLOCATION',
        stopReason: null,
        releaseAllocations: 'NONE',
      };
    }
    if (delivered >= input.remainingAmount) {
      const transitions: PlannedTransition[] = [];
      if (orderStatus === 'PROCESSING') {
        transitions.push({
          from: 'PROCESSING',
          to: 'FULFILLMENT_PENDING',
          reason: REASONS.pending,
        });
      }
      transitions.push({
        from: 'FULFILLMENT_PENDING',
        to: 'FULFILLED',
        event: OrderEvent.FULFILLMENT_COMPLETED,
        reason: REASONS.completed,
      });
      return {
        transitions,
        attemptStatus,
        deliveredAmount: delivered,
        fulfillmentOrderStatus: 'FULFILLED',
        outcome: 'FULFILLED',
        stopReason: null,
        releaseAllocations: 'ALL',
      };
    }
    return retryOrStop(
      {
        from: orderStatus,
        to: 'PARTIALLY_FULFILLED',
        event: OrderEvent.FULFILLMENT_PARTIAL,
        reason: REASONS.partial,
      },
      {
        attemptStatus,
        delivered,
        alreadyFulfilled: input.fulfilledAmount,
        exhausted,
        releaseOnRetry: 'NONE',
      },
    );
  }

  if (resolution.kind === 'AWAITING') {
    const transitions: PlannedTransition[] = [];
    if (orderStatus === 'PROCESSING') {
      transitions.push({
        from: 'PROCESSING',
        to: 'FULFILLMENT_PENDING',
        event: OrderEvent.FULFILLMENT_PENDING,
        reason: REASONS.pending,
      });
    }
    if (input.finalRun) {
      transitions.push({
        from: 'FULFILLMENT_PENDING',
        to: 'RECONCILIATION_REQUIRED',
        event: OrderEvent.FULFILLMENT_RECONCILIATION_REQUIRED,
        reason: REASONS.inconclusive,
      });
      return {
        transitions,
        attemptStatus: resolution.attemptStatus,
        deliveredAmount: 0,
        fulfillmentOrderStatus: 'RECONCILIATION_REQUIRED',
        outcome: 'RECONCILIATION_REQUIRED',
        stopReason: 'VERIFICATION_INCONCLUSIVE',
        // Robux may have left the source: the reservation stays until reconciliation decides.
        releaseAllocations: 'NONE',
      };
    }
    return {
      transitions,
      attemptStatus: resolution.attemptStatus,
      deliveredAmount: 0,
      fulfillmentOrderStatus: 'IN_PROGRESS',
      outcome: 'AWAITING_VERIFICATION',
      stopReason: null,
      releaseAllocations: 'NONE',
    };
  }

  const failed: PlannedTransition = {
    from: orderStatus,
    to: 'FAILED',
    event: OrderEvent.FULFILLMENT_FAILED,
    reason: REASONS.failed,
  };
  const attemptStatus =
    input.attemptRequestedAmount === null
      ? null
      : resolution.retryable
        ? 'FAILED_RETRYABLE'
        : 'FAILED_PERMANENT';
  if (!resolution.retryable) {
    return {
      transitions: [
        failed,
        {
          from: 'FAILED',
          to: 'FAILED_PERMANENTLY',
          event: OrderEvent.FULFILLMENT_PERMANENTLY_FAILED,
          reason: REASONS.permanentlyFailed,
        },
      ],
      attemptStatus,
      deliveredAmount: 0,
      fulfillmentOrderStatus: finalStatusOf(input.fulfilledAmount),
      outcome: 'FAILED_PERMANENTLY',
      stopReason: resolution.error,
      releaseAllocations: 'ALL',
    };
  }
  return retryOrStop(failed, {
    attemptStatus,
    delivered: 0,
    alreadyFulfilled: input.fulfilledAmount,
    exhausted,
    releaseOnRetry: 'CURRENT',
  });
}

function retryOrStop(
  first: PlannedTransition,
  state: {
    attemptStatus: FulfillmentAttemptStatus | null;
    delivered: number;
    alreadyFulfilled: number;
    exhausted: boolean;
    releaseOnRetry: 'NONE' | 'CURRENT';
  },
): FulfillmentPlan {
  const from = first.to;
  if (state.exhausted) {
    return {
      transitions: [
        first,
        {
          from,
          to: 'FAILED_PERMANENTLY',
          event: OrderEvent.FULFILLMENT_PERMANENTLY_FAILED,
          reason: REASONS.exhausted,
        },
      ],
      attemptStatus: state.attemptStatus,
      deliveredAmount: state.delivered,
      fulfillmentOrderStatus: finalStatusOf(state.alreadyFulfilled + state.delivered),
      outcome: 'FAILED_PERMANENTLY',
      stopReason: 'RETRY_EXHAUSTED',
      releaseAllocations: 'ALL',
    };
  }
  return {
    transitions: [
      first,
      { from, to: 'RETRYING', event: OrderEvent.FULFILLMENT_RETRYING, reason: REASONS.retrying },
    ],
    attemptStatus: state.attemptStatus,
    deliveredAmount: state.delivered,
    fulfillmentOrderStatus: 'IN_PROGRESS',
    outcome: 'RETRY_SCHEDULED',
    stopReason: null,
    releaseAllocations: state.releaseOnRetry,
  };
}

function finalStatusOf(fulfilledAmount: number): FulfillmentOrderStatus {
  return fulfilledAmount > 0 ? 'PARTIALLY_FULFILLED' : 'FAILED';
}
