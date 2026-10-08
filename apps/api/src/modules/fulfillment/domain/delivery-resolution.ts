import type {
  FulfillmentResult,
  ProviderErrorCode,
  VerificationResult,
} from './fulfillment-provider';

/** Why a request did not (or may not) deliver, as recorded on attempts and in history. */
export type FulfillmentFailureCode =
  | ProviderErrorCode
  /** Verification found no record of the reference: nothing was delivered. */
  | 'NOT_FOUND'
  /** Routing found no active, healthy source (or not enough inventory) for the remaining amount. */
  | 'NO_ELIGIBLE_SOURCE';

/**
 * What one provider answer means for the order, independent of how it was obtained (a fulfill
 * call or a verification).
 *
 * DELIVERED: `fulfilledAmount` Robux reached the recipient (all or part of the request).
 * AWAITING: the outcome is not known yet. The attempt stays live and is verified later; it is never
 *   executed again while in this state.
 * NOT_DELIVERED: nothing was delivered; `retryable` says whether trying again can help.
 */
export type DeliveryResolution =
  | { kind: 'DELIVERED'; fulfilledAmount: number; providerReference: string }
  | {
      kind: 'AWAITING';
      attemptStatus: 'VERIFYING' | 'UNKNOWN';
      providerReference: string | null;
      error: FulfillmentFailureCode | null;
    }
  | {
      kind: 'NOT_DELIVERED';
      retryable: boolean;
      error: FulfillmentFailureCode;
      providerReference: string | null;
    };

/**
 * A delivered amount outside 1..requested is not trustworthy. It is treated as unknown so that
 * verification (or a human) settles it, instead of recording an impossible amount.
 */
function delivered(
  providerReference: string,
  fulfilledAmount: number,
  requestedAmount: number,
): DeliveryResolution {
  if (
    !Number.isInteger(fulfilledAmount) ||
    fulfilledAmount < 1 ||
    fulfilledAmount > requestedAmount
  ) {
    return { kind: 'AWAITING', attemptStatus: 'UNKNOWN', providerReference, error: 'UNKNOWN' };
  }
  return { kind: 'DELIVERED', fulfilledAmount, providerReference };
}

export function resolveFulfillResult(
  result: FulfillmentResult,
  requestedAmount: number,
): DeliveryResolution {
  switch (result.status) {
    case 'SUCCEEDED':
    case 'PARTIAL':
      return delivered(result.providerReference, result.fulfilledAmount, requestedAmount);
    case 'PENDING':
      return {
        kind: 'AWAITING',
        attemptStatus: 'VERIFYING',
        providerReference: result.providerReference,
        error: null,
      };
    case 'RETRYABLE_FAILURE':
      return {
        kind: 'NOT_DELIVERED',
        retryable: true,
        error: result.error,
        providerReference: null,
      };
    case 'PERMANENT_FAILURE':
      return {
        kind: 'NOT_DELIVERED',
        retryable: false,
        error: result.error,
        providerReference: result.providerReference ?? null,
      };
    case 'UNKNOWN':
      return {
        kind: 'AWAITING',
        attemptStatus: 'UNKNOWN',
        providerReference: null,
        error: result.error,
      };
  }
}

/**
 * Verify-before-retry: only NOT_FOUND makes an unknown request eligible for another execution. An
 * unanswered verification keeps the attempt as it was (still unknown, or still pending).
 */
export function resolveVerification(
  result: VerificationResult,
  attempt: {
    requestedAmount: number;
    status: 'VERIFYING' | 'UNKNOWN';
    providerReference: string | null;
  },
): DeliveryResolution {
  switch (result.status) {
    case 'SUCCEEDED':
    case 'PARTIAL':
      return delivered(result.providerReference, result.fulfilledAmount, attempt.requestedAmount);
    case 'PENDING':
      return {
        kind: 'AWAITING',
        attemptStatus: 'VERIFYING',
        providerReference: result.providerReference,
        error: null,
      };
    case 'FAILED':
      // The provider settled the request as failed. The same reference would only replay that
      // failure, so this is final for the request.
      return {
        kind: 'NOT_DELIVERED',
        retryable: false,
        error: result.error,
        providerReference: result.providerReference,
      };
    case 'NOT_FOUND':
      return {
        kind: 'NOT_DELIVERED',
        retryable: true,
        error: 'NOT_FOUND',
        providerReference: null,
      };
    case 'UNAVAILABLE':
      return {
        kind: 'AWAITING',
        attemptStatus: attempt.status,
        providerReference: attempt.providerReference,
        error: result.error,
      };
  }
}
