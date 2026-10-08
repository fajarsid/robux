import { resolveFulfillResult, resolveVerification } from './delivery-resolution';
import { nextClientReference } from './client-reference';
import type { FulfillmentWorkflow } from './fulfillment-workflow.repository';

describe('resolveFulfillResult', () => {
  it.each([
    [{ status: 'SUCCEEDED', providerReference: 'P', fulfilledAmount: 500 }, 'DELIVERED'],
    [{ status: 'PARTIAL', providerReference: 'P', fulfilledAmount: 250 }, 'DELIVERED'],
    [{ status: 'PENDING', providerReference: 'P' }, 'AWAITING'],
    [{ status: 'UNKNOWN', error: 'TIMEOUT' }, 'AWAITING'],
    [{ status: 'RETRYABLE_FAILURE', error: 'UNAVAILABLE' }, 'NOT_DELIVERED'],
    [{ status: 'PERMANENT_FAILURE', error: 'REJECTED' }, 'NOT_DELIVERED'],
  ] as const)('%o → %s', (result, kind) => {
    expect(resolveFulfillResult(result, 500).kind).toBe(kind);
  });

  it('treats an unknown outcome as unknown, never as a failure that may be re-sent', () => {
    expect(resolveFulfillResult({ status: 'UNKNOWN', error: 'TIMEOUT' }, 500)).toEqual({
      kind: 'AWAITING',
      attemptStatus: 'UNKNOWN',
      providerReference: null,
      error: 'TIMEOUT',
    });
  });

  it('distinguishes retryable from permanent failures', () => {
    expect(
      resolveFulfillResult({ status: 'RETRYABLE_FAILURE', error: 'INSUFFICIENT_BALANCE' }, 1),
    ).toMatchObject({ retryable: true, error: 'INSUFFICIENT_BALANCE' });
    expect(
      resolveFulfillResult({ status: 'PERMANENT_FAILURE', error: 'INVALID_RECIPIENT' }, 1),
    ).toMatchObject({ retryable: false, error: 'INVALID_RECIPIENT' });
  });

  it.each([0, -1, 501, 1.5])('does not trust a delivered amount of %s for 500', (amount) => {
    expect(
      resolveFulfillResult(
        { status: 'SUCCEEDED', providerReference: 'P', fulfilledAmount: amount },
        500,
      ),
    ).toMatchObject({ kind: 'AWAITING', attemptStatus: 'UNKNOWN' });
  });
});

describe('resolveVerification (verify before retry)', () => {
  const attempt = { requestedAmount: 500, status: 'UNKNOWN' as const, providerReference: null };

  it('SUCCEEDED and PARTIAL settle the delivery', () => {
    expect(
      resolveVerification(
        { status: 'SUCCEEDED', providerReference: 'P', fulfilledAmount: 500 },
        attempt,
      ),
    ).toEqual({ kind: 'DELIVERED', fulfilledAmount: 500, providerReference: 'P' });
    expect(
      resolveVerification(
        { status: 'PARTIAL', providerReference: 'P', fulfilledAmount: 200 },
        attempt,
      ),
    ).toMatchObject({ kind: 'DELIVERED', fulfilledAmount: 200 });
  });

  it('PENDING keeps waiting', () => {
    expect(
      resolveVerification({ status: 'PENDING', providerReference: 'P' }, attempt),
    ).toMatchObject({
      kind: 'AWAITING',
      attemptStatus: 'VERIFYING',
    });
  });

  it('only NOT_FOUND makes the request retry-eligible', () => {
    expect(resolveVerification({ status: 'NOT_FOUND' }, attempt)).toEqual({
      kind: 'NOT_DELIVERED',
      retryable: true,
      error: 'NOT_FOUND',
      providerReference: null,
    });
  });

  it('UNAVAILABLE keeps the attempt as it was and asks again later', () => {
    expect(resolveVerification({ status: 'UNAVAILABLE', error: 'UNAVAILABLE' }, attempt)).toEqual({
      kind: 'AWAITING',
      attemptStatus: 'UNKNOWN',
      providerReference: null,
      error: 'UNAVAILABLE',
    });
  });

  it('a request the provider settled as failed is final', () => {
    expect(
      resolveVerification({ status: 'FAILED', providerReference: 'P', error: 'REJECTED' }, attempt),
    ).toMatchObject({ kind: 'NOT_DELIVERED', retryable: false, providerReference: 'P' });
  });
});

describe('nextClientReference', () => {
  const workflow = (overrides: Partial<FulfillmentWorkflow>): FulfillmentWorkflow => ({
    orderId: 'order-1',
    orderStatus: 'PROCESSING',
    method: 'INSTANT',
    productLine: 'ROBLOX_ROBUX',
    fulfillmentType: 'BALANCE_PURCHASE',
    recipient: { type: 'ROBLOX_USER', identifier: 'player', externalUserId: null },
    fulfillmentOrderId: 'fo-1',
    requestedAmount: 1000,
    fulfilledAmount: 0,
    remainingAmount: 1000,
    retriesUsed: 0,
    lastAttemptNumber: 0,
    referencesUsed: 0,
    latestAttempt: null,
    openAllocations: [],
    leaseToken: 'lease',
    ...overrides,
  });
  const attempt = (status: 'FAILED_RETRYABLE' | 'PARTIAL' | 'FAILED_PERMANENT', amount = 1000) => ({
    id: 'a',
    attemptNumber: 1,
    provider: 'mock',
    clientReference: 'FULFILLMENT-order-1-1',
    requestedAmount: amount,
    status,
    providerReference: null,
    allocationId: 'allocation-1',
  });

  it('is deterministic for the first request', () => {
    expect(nextClientReference(workflow({}), 1000)).toBe('FULFILLMENT-order-1-1');
  });

  it('reuses the reference for every retry of an undelivered request', () => {
    const retry = workflow({
      latestAttempt: attempt('FAILED_RETRYABLE'),
      lastAttemptNumber: 1,
      referencesUsed: 1,
    });
    expect(nextClientReference(retry, 1000)).toBe('FULFILLMENT-order-1-1');
    expect(nextClientReference({ ...retry, lastAttemptNumber: 2 }, 1000)).toBe(
      'FULFILLMENT-order-1-1',
    );
  });

  it('uses a new reference only for a different request (the remainder after a partial)', () => {
    expect(
      nextClientReference(
        workflow({
          latestAttempt: attempt('PARTIAL'),
          referencesUsed: 1,
          fulfilledAmount: 500,
          remainingAmount: 500,
        }),
        500,
      ),
    ).toBe('FULFILLMENT-order-1-2');
  });

  it('a retry for a different amount (re-routed remainder of a split plan) gets a new reference', () => {
    const retry = workflow({
      latestAttempt: attempt('FAILED_RETRYABLE', 700),
      lastAttemptNumber: 1,
      referencesUsed: 1,
    });
    expect(nextClientReference(retry, 700)).toBe('FULFILLMENT-order-1-1');
    expect(nextClientReference(retry, 1000)).toBe('FULFILLMENT-order-1-2');
  });
});
