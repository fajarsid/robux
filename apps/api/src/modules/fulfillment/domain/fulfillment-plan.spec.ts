import { assertTransition } from '../../orders/domain/order-state-machine';
import type { DeliveryResolution } from './delivery-resolution';
import { type PlanInput, planFulfillment } from './fulfillment-plan';

const delivered = (n: number): DeliveryResolution => ({
  kind: 'DELIVERED',
  fulfilledAmount: n,
  providerReference: 'P-1',
});
const awaiting = (status: 'VERIFYING' | 'UNKNOWN' = 'VERIFYING'): DeliveryResolution => ({
  kind: 'AWAITING',
  attemptStatus: status,
  providerReference: status === 'VERIFYING' ? 'P-1' : null,
  error: status === 'UNKNOWN' ? 'TIMEOUT' : null,
});
const notDelivered = (retryable: boolean, error = 'UNAVAILABLE' as const): DeliveryResolution => ({
  kind: 'NOT_DELIVERED',
  retryable,
  error,
  providerReference: null,
});

function plan(resolution: DeliveryResolution, overrides: Partial<PlanInput> = {}) {
  const result = planFulfillment({
    orderStatus: 'PROCESSING',
    fulfilledAmount: 0,
    remainingAmount: 1000,
    attemptRequestedAmount: 1000,
    resolution,
    retriesUsed: 0,
    maxAttempts: 5,
    finalRun: false,
    ...overrides,
  });
  // Every planned step is allowed by the order state machine, in order.
  for (const t of result.transitions) {
    expect(() => assertTransition(t.from, t.to)).not.toThrow();
  }
  for (let i = 1; i < result.transitions.length; i += 1) {
    expect(result.transitions[i]!.from).toBe(result.transitions[i - 1]!.to);
  }
  return result;
}

const path = (p: ReturnType<typeof plan>) => p.transitions.map((t) => `${t.from}>${t.to}`);

describe('planFulfillment: inventory effects (Phase 10)', () => {
  it('an allocation delivered in full while others remain: next allocation, same run, no transition', () => {
    const result = plan(delivered(600), { attemptRequestedAmount: 600 });
    expect(result).toMatchObject({
      outcome: 'NEXT_ALLOCATION',
      transitions: [],
      attemptStatus: 'SUCCEEDED',
      deliveredAmount: 600,
      releaseAllocations: 'NONE',
    });
  });

  it('after verification the same case cannot go back to PROCESSING: it continues as a partial', () => {
    const result = plan(delivered(600), {
      orderStatus: 'FULFILLMENT_PENDING',
      attemptRequestedAmount: 600,
    });
    expect(path(result)).toEqual([
      'FULFILLMENT_PENDING>PARTIALLY_FULFILLED',
      'PARTIALLY_FULFILLED>RETRYING',
    ]);
  });

  it.each([
    ['success releases leftovers (none expected)', delivered(1000), {}, 'ALL'],
    ['partial keeps the remainder reserved', delivered(500), {}, 'NONE'],
    ['pending keeps the reservation', awaiting('VERIFYING'), {}, 'NONE'],
    ['unknown keeps the reservation', awaiting('UNKNOWN'), {}, 'NONE'],
    [
      'unknown at the end keeps it for reconciliation',
      awaiting('UNKNOWN'),
      { finalRun: true },
      'NONE',
    ],
    ['retryable failure gives this source back', notDelivered(true), {}, 'CURRENT'],
    ['permanent failure gives everything back', notDelivered(false), {}, 'ALL'],
    ['exhausted retries give everything back', notDelivered(true), { retriesUsed: 4 }, 'ALL'],
    ['exhausted after a partial gives the rest back', delivered(500), { finalRun: true }, 'ALL'],
  ] as const)('%s', (_label, resolution, overrides, release) => {
    expect(plan(resolution, overrides).releaseAllocations).toBe(release);
  });
});

describe('planFulfillment', () => {
  it('SUCCEEDED for the whole remainder: FULFILLED with the completion event', () => {
    const result = plan(delivered(1000));
    expect(path(result)).toEqual([
      'PROCESSING>FULFILLMENT_PENDING',
      'FULFILLMENT_PENDING>FULFILLED',
    ]);
    expect(result.transitions.at(-1)!.event).toBe('FULFILLMENT_COMPLETED');
    expect(result).toMatchObject({
      outcome: 'FULFILLED',
      attemptStatus: 'SUCCEEDED',
      deliveredAmount: 1000,
      fulfillmentOrderStatus: 'FULFILLED',
    });
  });

  it('verified success after pending goes straight from FULFILLMENT_PENDING', () => {
    expect(path(plan(delivered(1000), { orderStatus: 'FULFILLMENT_PENDING' }))).toEqual([
      'FULFILLMENT_PENDING>FULFILLED',
    ]);
  });

  it('PARTIAL: records the delivered amount and retries only the remainder', () => {
    const result = plan(delivered(500));
    expect(path(result)).toEqual([
      'PROCESSING>PARTIALLY_FULFILLED',
      'PARTIALLY_FULFILLED>RETRYING',
    ]);
    expect(result).toMatchObject({
      outcome: 'RETRY_SCHEDULED',
      attemptStatus: 'PARTIAL',
      deliveredAmount: 500,
      fulfillmentOrderStatus: 'IN_PROGRESS',
    });
  });

  it('completes when a later attempt delivers the remainder', () => {
    const result = plan(delivered(500), {
      fulfilledAmount: 500,
      remainingAmount: 500,
      attemptRequestedAmount: 500,
      retriesUsed: 1,
    });
    expect(result).toMatchObject({ outcome: 'FULFILLED', attemptStatus: 'SUCCEEDED' });
  });

  it('PENDING / UNKNOWN: waits for verification, never a failure or a retry', () => {
    for (const status of ['VERIFYING', 'UNKNOWN'] as const) {
      const result = plan(awaiting(status));
      expect(path(result)).toEqual(['PROCESSING>FULFILLMENT_PENDING']);
      expect(result).toMatchObject({ outcome: 'AWAITING_VERIFICATION', attemptStatus: status });
    }
    expect(path(plan(awaiting(), { orderStatus: 'FULFILLMENT_PENDING' }))).toEqual([]);
  });

  it('still unknown on the final run: reconciliation, not a guess', () => {
    const result = plan(awaiting('UNKNOWN'), { finalRun: true });
    expect(path(result)).toEqual([
      'PROCESSING>FULFILLMENT_PENDING',
      'FULFILLMENT_PENDING>RECONCILIATION_REQUIRED',
    ]);
    expect(result).toMatchObject({
      outcome: 'RECONCILIATION_REQUIRED',
      stopReason: 'VERIFICATION_INCONCLUSIVE',
      fulfillmentOrderStatus: 'RECONCILIATION_REQUIRED',
    });
  });

  it('RETRYABLE_FAILURE: FAILED then RETRYING', () => {
    const result = plan(notDelivered(true));
    expect(path(result)).toEqual(['PROCESSING>FAILED', 'FAILED>RETRYING']);
    expect(result).toMatchObject({ outcome: 'RETRY_SCHEDULED', attemptStatus: 'FAILED_RETRYABLE' });
  });

  it('verification NOT_FOUND after an unknown outcome is retry-eligible', () => {
    const result = plan(notDelivered(true, 'NOT_FOUND' as never), {
      orderStatus: 'FULFILLMENT_PENDING',
    });
    expect(path(result)).toEqual(['FULFILLMENT_PENDING>FAILED', 'FAILED>RETRYING']);
  });

  it('PERMANENT_FAILURE: FAILED_PERMANENTLY without a retry, error kept', () => {
    const result = plan(notDelivered(false, 'REJECTED' as never));
    expect(path(result)).toEqual(['PROCESSING>FAILED', 'FAILED>FAILED_PERMANENTLY']);
    expect(result).toMatchObject({
      outcome: 'FAILED_PERMANENTLY',
      attemptStatus: 'FAILED_PERMANENT',
      stopReason: 'REJECTED',
      fulfillmentOrderStatus: 'FAILED',
    });
  });

  it('a failure before any attempt (recipient, balance) changes no attempt', () => {
    const result = plan(notDelivered(false, 'INVALID_RECIPIENT' as never), {
      attemptRequestedAmount: null,
    });
    expect(result).toMatchObject({ attemptStatus: null, stopReason: 'INVALID_RECIPIENT' });
  });

  it('bounds automatic retries by the policy: the 5th run gives up with RETRY_EXHAUSTED', () => {
    expect(plan(notDelivered(true), { retriesUsed: 3 }).outcome).toBe('RETRY_SCHEDULED');
    const exhausted = plan(notDelivered(true), { retriesUsed: 4 });
    expect(path(exhausted)).toEqual(['PROCESSING>FAILED', 'FAILED>FAILED_PERMANENTLY']);
    expect(exhausted).toMatchObject({
      outcome: 'FAILED_PERMANENTLY',
      stopReason: 'RETRY_EXHAUSTED',
    });
  });

  it('the job’s final run never leaves a retry behind', () => {
    expect(plan(notDelivered(true), { finalRun: true }).outcome).toBe('FAILED_PERMANENTLY');
    const partial = plan(delivered(400), { finalRun: true });
    expect(path(partial)).toEqual([
      'PROCESSING>PARTIALLY_FULFILLED',
      'PARTIALLY_FULFILLED>FAILED_PERMANENTLY',
    ]);
    expect(partial).toMatchObject({
      deliveredAmount: 400,
      fulfillmentOrderStatus: 'PARTIALLY_FULFILLED',
      stopReason: 'RETRY_EXHAUSTED',
    });
  });
});
