import type { FulfillmentTypeName } from '@robux/shared';
import type { FulfillmentRecipient } from './fulfillment-provider';
import type { FulfillmentWorkflow } from './fulfillment-workflow.repository';

export type DeliveryTarget =
  | { ok: true; recipient: FulfillmentRecipient | null }
  /** The order's snapshot does not fit its fulfillment type: final, nothing can be delivered. */
  | { ok: false };

/**
 * What differs between fulfillment types (ADR-009); everything else (lease, routing and
 * reservation over the order's product line, attempts, verification, retries) is the engine's
 * shared workflow. A strategy says whom the provider delivers to and whether the provider checks
 * that recipient first. Adding a type is a new strategy, not a branch in the engine.
 */
export interface FulfillmentStrategy {
  readonly type: FulfillmentTypeName;
  readonly validatesRecipient: boolean;
  targetOf(workflow: FulfillmentWorkflow): DeliveryTarget;
}

/** Delivered to a recipient identity: Robux funded from a source balance. */
const BALANCE_PURCHASE: FulfillmentStrategy = {
  type: 'BALANCE_PURCHASE',
  validatesRecipient: true,
  targetOf: (workflow) =>
    workflow.recipient ? { ok: true, recipient: workflow.recipient } : { ok: false },
};

/** Delivered to a recipient identity by the provider: Telegram Premium, Telegram Stars. */
const RECIPIENT_FULFILLMENT: FulfillmentStrategy = {
  type: 'RECIPIENT_FULFILLMENT',
  validatesRecipient: true,
  targetOf: (workflow) =>
    workflow.recipient ? { ok: true, recipient: workflow.recipient } : { ok: false },
};

/**
 * Items from inventory (Telegram accounts), delivered to the order itself: there is no recipient
 * to name or validate. Each unit of the source's balance is one item; the source's allocation is
 * the item reservation (ADR-009).
 */
const DIGITAL_DELIVERY: FulfillmentStrategy = {
  type: 'DIGITAL_DELIVERY',
  validatesRecipient: false,
  targetOf: (workflow) => (workflow.recipient ? { ok: false } : { ok: true, recipient: null }),
};

const STRATEGIES: Readonly<Record<FulfillmentTypeName, FulfillmentStrategy>> = {
  BALANCE_PURCHASE,
  RECIPIENT_FULFILLMENT,
  DIGITAL_DELIVERY,
};

/** Deterministic: the order's fulfillment type snapshot always selects the same strategy. */
export function fulfillmentStrategyFor(type: FulfillmentTypeName): FulfillmentStrategy {
  return STRATEGIES[type];
}
