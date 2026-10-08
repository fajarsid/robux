import { describeFulfillmentProviderContract } from '../../../../../../test/contracts/fulfillment-provider.contract';
import type { FulfillmentRequest } from '../../../domain/fulfillment-provider';
import { MockFulfillmentProvider } from './mock-fulfillment.provider';
import { MockRecipient, type MockScenario } from './mock-scenario';

const valid = {
  type: 'ROBLOX_USER' as const,
  identifier: MockRecipient.VALID,
  externalUserId: null,
};

function mock(scenario: MockScenario = 'SUCCESS', balance = 10_000n) {
  return new MockFulfillmentProvider({ scenario, balance });
}

function request(overrides: Partial<FulfillmentRequest> = {}): FulfillmentRequest {
  return { clientReference: 'FULFILLMENT-123', recipient: valid, amount: 500, ...overrides };
}

describeFulfillmentProviderContract('MockFulfillmentProvider', () => {
  const provider = mock();
  return {
    provider,
    recipient: valid,
    amount: 500,
    deliveryCount: () => provider.deliveryCount(),
  };
});

describe('MockFulfillmentProvider scenarios', () => {
  it('SUCCESS: valid recipient, delivered, verified, balance reduced', async () => {
    const provider = mock('SUCCESS', 10_000n);
    expect(await provider.validateRecipient(valid)).toEqual({
      status: 'VALID',
      externalUserId: null,
    });
    const result = await provider.fulfill(request());
    expect(result).toEqual({
      status: 'SUCCEEDED',
      providerReference: 'MOCK-000001',
      fulfilledAmount: 500,
    });
    expect(await provider.verify({ clientReference: 'FULFILLMENT-123' })).toEqual(result);
    expect(
      await provider.verify({ clientReference: 'x', providerReference: 'MOCK-000001' }),
    ).toEqual(result);
    expect(await provider.getBalance()).toEqual({ status: 'AVAILABLE', units: 9_500n });
  });

  it('PENDING: accepted, still pending on verify, then settles as SUCCEEDED', async () => {
    const provider = mock('PENDING', 10_000n);
    const result = await provider.fulfill(request());
    expect(result).toEqual({ status: 'PENDING', providerReference: 'MOCK-000001' });
    expect(await provider.verify({ clientReference: 'FULFILLMENT-123' })).toEqual(result);
    // The amount is held while pending.
    expect(await provider.getBalance()).toEqual({ status: 'AVAILABLE', units: 9_500n });

    provider.settle('MOCK-000001', 'SUCCEEDED');
    expect(await provider.verify({ clientReference: 'FULFILLMENT-123' })).toEqual({
      status: 'SUCCEEDED',
      providerReference: 'MOCK-000001',
      fulfilledAmount: 500,
    });
    expect(await provider.getBalance()).toEqual({ status: 'AVAILABLE', units: 9_500n });
  });

  it('PENDING that later fails returns the held Robux', async () => {
    const provider = mock('PENDING', 10_000n);
    await provider.fulfill(request());
    provider.settle('MOCK-000001', 'FAILED');
    expect(await provider.verify({ clientReference: 'FULFILLMENT-123' })).toMatchObject({
      status: 'FAILED',
      error: 'REJECTED',
    });
    expect(await provider.getBalance()).toEqual({ status: 'AVAILABLE', units: 10_000n });
    expect(() => provider.settle('MOCK-000001', 'SUCCEEDED')).toThrow();
  });

  it('PARTIAL: delivers part of the amount and says how much', async () => {
    const provider = mock('PARTIAL', 10_000n);
    expect(await provider.fulfill(request())).toEqual({
      status: 'PARTIAL',
      providerReference: 'MOCK-000001',
      fulfilledAmount: 250,
    });
    expect(await provider.getBalance()).toEqual({ status: 'AVAILABLE', units: 9_750n });
  });

  it('RETRYABLE_FAILURE: nothing delivered, nothing recorded, a retry can succeed', async () => {
    const provider = mock('RETRYABLE_FAILURE');
    expect(await provider.fulfill(request())).toEqual({
      status: 'RETRYABLE_FAILURE',
      error: 'UNAVAILABLE',
    });
    expect(await provider.verify({ clientReference: 'FULFILLMENT-123' })).toEqual({
      status: 'NOT_FOUND',
    });
    provider.setScenario('SUCCESS');
    expect((await provider.fulfill(request())).status).toBe('SUCCEEDED');
  });

  it('PERMANENT_FAILURE: refused for good, and repeating the reference gives the same answer', async () => {
    const provider = mock('PERMANENT_FAILURE', 10_000n);
    const result = await provider.fulfill(request());
    expect(result).toEqual({
      status: 'PERMANENT_FAILURE',
      error: 'REJECTED',
      providerReference: 'MOCK-000001',
    });
    provider.setScenario('SUCCESS');
    expect(await provider.fulfill(request())).toEqual(result);
    expect(await provider.getBalance()).toEqual({ status: 'AVAILABLE', units: 10_000n });
  });

  it('SUCCEEDED_BUT_TIMED_OUT: reports UNKNOWN although it delivered; verify tells the truth', async () => {
    const provider = mock('SUCCEEDED_BUT_TIMED_OUT', 10_000n);
    expect(await provider.fulfill(request())).toEqual({ status: 'UNKNOWN', error: 'TIMEOUT' });
    expect(await provider.verify({ clientReference: 'FULFILLMENT-123' })).toEqual({
      status: 'SUCCEEDED',
      providerReference: 'MOCK-000001',
      fulfilledAmount: 500,
    });
    // Retrying with the same reference after a timeout never delivers a second time.
    provider.setScenario('SUCCESS');
    expect((await provider.fulfill(request())).status).toBe('SUCCEEDED');
    expect(provider.deliveryCount()).toBe(1);
    expect(await provider.getBalance()).toEqual({ status: 'AVAILABLE', units: 9_500n });
  });

  it('INVALID_RECIPIENT: invalid on validation, permanent failure on fulfill', async () => {
    const provider = mock('INVALID_RECIPIENT');
    expect(await provider.validateRecipient(valid)).toEqual({ status: 'INVALID' });
    expect(await provider.fulfill(request())).toMatchObject({
      status: 'PERMANENT_FAILURE',
      error: 'INVALID_RECIPIENT',
    });
  });

  it('UNAVAILABLE: balance, validation, fulfill and verify all report the outage', async () => {
    const provider = mock('SUCCESS');
    await provider.fulfill(request());
    provider.setScenario('UNAVAILABLE');
    expect(await provider.getBalance()).toEqual({ status: 'UNAVAILABLE', error: 'UNAVAILABLE' });
    expect(await provider.validateRecipient(valid)).toEqual({
      status: 'UNAVAILABLE',
      error: 'UNAVAILABLE',
    });
    expect(await provider.fulfill(request({ clientReference: 'other' }))).toEqual({
      status: 'RETRYABLE_FAILURE',
      error: 'UNAVAILABLE',
    });
    // Unknown is not "not found": the earlier delivery must not look undelivered.
    expect(await provider.verify({ clientReference: 'FULFILLMENT-123' })).toEqual({
      status: 'UNAVAILABLE',
      error: 'UNAVAILABLE',
    });
  });
});

describe('MockFulfillmentProvider fixed recipients', () => {
  it.each([
    [MockRecipient.VALID, { status: 'VALID', externalUserId: null }],
    [MockRecipient.INVALID, { status: 'INVALID' }],
    [MockRecipient.UNAVAILABLE, { status: 'UNAVAILABLE', error: 'UNAVAILABLE' }],
  ])('%s validates the same under the SUCCESS scenario', async (identifier, expected) => {
    expect(
      await mock().validateRecipient({ type: 'ROBLOX_USER', identifier, externalUserId: null }),
    ).toEqual(expected);
  });

  it('fails delivery to the invalid and unavailable fixtures accordingly', async () => {
    const provider = mock();
    expect(
      await provider.fulfill(
        request({
          recipient: {
            type: 'ROBLOX_USER',
            identifier: MockRecipient.INVALID,
            externalUserId: null,
          },
        }),
      ),
    ).toMatchObject({ status: 'PERMANENT_FAILURE', error: 'INVALID_RECIPIENT' });
    expect(
      await provider.fulfill(
        request({
          clientReference: 'second',
          recipient: {
            type: 'ROBLOX_USER',
            identifier: MockRecipient.UNAVAILABLE,
            externalUserId: null,
          },
        }),
      ),
    ).toEqual({ status: 'RETRYABLE_FAILURE', error: 'UNAVAILABLE' });
  });
});

describe('MockFulfillmentProvider balance', () => {
  it.each([0n, 499n])(
    'refuses a delivery above the balance (%s) as retryable, without effect',
    async (balance) => {
      const provider = mock('SUCCESS', balance);
      expect(await provider.fulfill(request())).toEqual({
        status: 'RETRYABLE_FAILURE',
        error: 'INSUFFICIENT_BALANCE',
      });
      expect(provider.deliveryCount()).toBe(0);
      expect(await provider.getBalance()).toEqual({ status: 'AVAILABLE', units: balance });
    },
  );

  it('delivers once the balance is topped up, with the same reference', async () => {
    const provider = mock('SUCCESS', 0n);
    await provider.fulfill(request());
    provider.setBalance(500n);
    expect((await provider.fulfill(request())).status).toBe('SUCCEEDED');
    expect(await provider.getBalance()).toEqual({ status: 'AVAILABLE', units: 0n });
  });
});

describe('MockFulfillmentProvider idempotency', () => {
  it('returns one result for ten concurrent calls with the same reference', async () => {
    const provider = mock('SUCCESS', 10_000n);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => provider.fulfill(request())),
    );
    expect(new Set(results.map((r) => JSON.stringify(r))).size).toBe(1);
    expect(results[0]).toMatchObject({ status: 'SUCCEEDED', providerReference: 'MOCK-000001' });
    expect(provider.deliveryCount()).toBe(1);
    expect(await provider.getBalance()).toEqual({ status: 'AVAILABLE', units: 9_500n });
  });

  it('keeps different references independent', async () => {
    const provider = mock('SUCCESS', 10_000n);
    const first = await provider.fulfill(request({ clientReference: 'A' }));
    const second = await provider.fulfill(request({ clientReference: 'B' }));
    expect(first).toMatchObject({ providerReference: 'MOCK-000001' });
    expect(second).toMatchObject({ providerReference: 'MOCK-000002' });
    expect(provider.deliveryCount()).toBe(2);
    expect(await provider.getBalance()).toEqual({ status: 'AVAILABLE', units: 9_000n });
  });

  it('keeps the first outcome when the scenario changes later', async () => {
    const provider = mock('PENDING', 10_000n);
    await provider.fulfill(request());
    provider.setScenario('PERMANENT_FAILURE');
    expect(await provider.fulfill(request())).toEqual({
      status: 'PENDING',
      providerReference: 'MOCK-000001',
    });
  });
});
