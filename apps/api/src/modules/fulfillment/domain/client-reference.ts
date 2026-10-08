import type { FulfillmentWorkflow } from './fulfillment-workflow.repository';

/**
 * The idempotency reference for the next attempt of `amount` Robux. A request the provider did not
 * deliver (FAILED_RETRYABLE, including verification NOT_FOUND) is retried with the same reference
 * and amount, so a provider that did execute it after all can only answer with that one delivery.
 * A new reference is used only for a different request: the remainder after a partial delivery,
 * the next allocation of a multi-source plan, or a manual retry after a final failure.
 */
export function nextClientReference(workflow: FulfillmentWorkflow, amount: number): string {
  const latest = workflow.latestAttempt;
  if (latest && latest.status === 'FAILED_RETRYABLE' && latest.requestedAmount === amount) {
    return latest.clientReference;
  }
  return `FULFILLMENT-${workflow.orderId}-${workflow.referencesUsed + 1}`;
}
