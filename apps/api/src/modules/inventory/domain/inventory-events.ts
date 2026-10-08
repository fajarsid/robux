/**
 * Outbox events about a fulfillment source (aggregate `fulfillment_source`). Not routed yet: the
 * notification consumers (Telegram, Discord, admin dashboard) arrive in a later phase.
 */
export const InventoryEvent = {
  /** available_balance crossed below low_balance_threshold (once per crossing). */
  SOURCE_LOW_BALANCE: 'SOURCE_LOW_BALANCE',
  /** Consecutive provider failures took the source out of routing (PRD §38 PROVIDER_OFFLINE). */
  SOURCE_UNAVAILABLE: 'SOURCE_UNAVAILABLE',
} as const;

export const SOURCE_AGGREGATE = 'fulfillment_source';

/** Failures in a row (unavailable, timeout, rate limited) before a source leaves routing. */
export const UNAVAILABLE_AFTER_CONSECUTIVE_FAILURES = 3;
