import { createHash } from 'node:crypto';

/** How long a key keeps returning its original order. Retries after that create a new order. */
export const ORDER_IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Keys are scoped per customer (or to guests as a whole) so two customers cannot collide, and
 * nobody can replay another customer's request.
 */
export function idempotencyScope(customerId: string | undefined): string {
  return customerId ? `orders.create:customer:${customerId}` : 'orders.create:guest';
}

/** Stable fingerprint of what was asked for; key order in objects does not matter. */
export function requestFingerprint(request: unknown): string {
  return createHash('sha256').update(canonicalJson(request)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
