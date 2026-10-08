import type { RecipientTypeName } from '@robux/shared';

/**
 * The port every fulfillment provider implements (ADR-005). The fulfillment engine (Phase 9)
 * depends on this file only; provider formats, endpoints and errors stay in the adapter. Amounts
 * are units of the product line (Robux, Stars, Premium months, accounts; ADR-009), never money.
 */

/** Normalized provider error. Raw provider messages never leave the adapter. */
export type ProviderErrorCode =
  | 'UNAVAILABLE'
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'INVALID_RECIPIENT'
  | 'INSUFFICIENT_BALANCE'
  /** The client reference was already used for a different request (amount or recipient). */
  | 'DUPLICATE_REFERENCE'
  /** The provider refused this request for good (policy, limits, unsupported amount). */
  | 'REJECTED'
  | 'UNKNOWN';

/**
 * Who receives a recipient fulfillment: a Roblox or Telegram user named by username, plus the
 * platform's own user id once a documented lookup has resolved it. Never a password, cookie or
 * session of the customer (R-01).
 */
export interface FulfillmentRecipient {
  type: RecipientTypeName;
  identifier: string;
  externalUserId: string | null;
}

export type ProviderBalance =
  { status: 'AVAILABLE'; units: bigint } | { status: 'UNAVAILABLE'; error: ProviderErrorCode };

export type RecipientValidation =
  | { status: 'VALID'; externalUserId: string | null }
  | { status: 'INVALID' }
  | { status: 'UNAVAILABLE'; error: ProviderErrorCode };

export interface FulfillmentRequest {
  /**
   * Idempotency key chosen by us (one per fulfillment attempt). Sending the same reference again
   * must never cause a second delivery; it returns the outcome of the first.
   */
  clientReference: string;
  /** Null for digital delivery: the items are delivered to the order, not to a recipient. */
  recipient: FulfillmentRecipient | null;
  amount: number;
  /** For log correlation only; never sent to the provider. */
  correlationId?: string | null;
}

/**
 * SUCCEEDED / PARTIAL: units delivered (all / `fulfilledAmount` of them).
 * PENDING: accepted, outcome later; verify.
 * RETRYABLE_FAILURE: nothing was delivered and trying again may work.
 * PERMANENT_FAILURE: nothing was delivered and trying again will not help.
 * UNKNOWN: the provider may or may not have executed (timeout, crash). Never execute again:
 *   verify by client reference first.
 */
export type FulfillmentResult =
  | { status: 'SUCCEEDED'; providerReference: string; fulfilledAmount: number }
  | { status: 'PARTIAL'; providerReference: string; fulfilledAmount: number }
  | { status: 'PENDING'; providerReference: string }
  | { status: 'RETRYABLE_FAILURE'; error: ProviderErrorCode }
  | { status: 'PERMANENT_FAILURE'; error: ProviderErrorCode; providerReference?: string }
  | { status: 'UNKNOWN'; error: ProviderErrorCode };

export type FulfillmentStatus = FulfillmentResult['status'];

/** Look a delivery up by our reference (always known) or the provider's (known once accepted). */
export interface VerificationLookup {
  clientReference: string;
  providerReference?: string | null;
  correlationId?: string | null;
}

/**
 * NOT_FOUND: the provider has no record of the reference, so nothing was delivered.
 * UNAVAILABLE: the provider could not answer; the outcome is still unknown, ask again later.
 */
export type VerificationResult =
  | { status: 'SUCCEEDED'; providerReference: string; fulfilledAmount: number }
  | { status: 'PARTIAL'; providerReference: string; fulfilledAmount: number }
  | { status: 'PENDING'; providerReference: string }
  | { status: 'FAILED'; providerReference: string; error: ProviderErrorCode }
  | { status: 'NOT_FOUND' }
  | { status: 'UNAVAILABLE'; error: ProviderErrorCode };

export interface FulfillmentProvider {
  /** Matches `fulfillment_sources.provider`. */
  readonly code: string;
  getBalance(): Promise<ProviderBalance>;
  validateRecipient(recipient: FulfillmentRecipient): Promise<RecipientValidation>;
  fulfill(request: FulfillmentRequest): Promise<FulfillmentResult>;
  verify(lookup: VerificationLookup): Promise<VerificationResult>;
}
