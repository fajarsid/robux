import { randomUUID } from 'node:crypto';
import type {
  FulfillmentProvider,
  FulfillmentRecipient,
  FulfillmentResult,
} from '../../src/modules/fulfillment/domain/fulfillment-provider';

export interface ProviderContractHarness {
  provider: FulfillmentProvider;
  /** A recipient the provider delivers to in its normal, successful configuration. */
  recipient: FulfillmentRecipient;
  /** A small amount the provider accepts and can cover. */
  amount: number;
  /** Number of real (or simulated) deliveries performed so far, when the adapter can tell. */
  deliveryCount?: () => number;
}

const DELIVERED = ['SUCCEEDED', 'PARTIAL', 'PENDING'] as const;

function providerReferenceOf(result: FulfillmentResult): string | undefined {
  return 'providerReference' in result ? result.providerReference : undefined;
}

/**
 * Behaviour every FulfillmentProvider adapter must have (ADR-005). Runs against the mock now and
 * against an authorized provider's sandbox later, so the fulfillment engine can rely on it.
 */
export function describeFulfillmentProviderContract(
  name: string,
  setup: () => ProviderContractHarness,
): void {
  describe(`FulfillmentProvider contract: ${name}`, () => {
    let harness: ProviderContractHarness;
    const newReference = () => `contract-${randomUUID()}`;

    beforeEach(() => {
      harness = setup();
    });

    it('reports its balance as Robux units or as unavailable', async () => {
      const balance = await harness.provider.getBalance();
      if (balance.status === 'AVAILABLE') {
        expect(typeof balance.units).toBe('bigint');
        expect(balance.units >= 0n).toBe(true);
      } else {
        expect(balance.status).toBe('UNAVAILABLE');
      }
    });

    it('accepts a delivery and can be asked about it by our reference', async () => {
      const clientReference = newReference();
      const result = await harness.provider.fulfill({
        clientReference,
        recipient: harness.recipient,
        amount: harness.amount,
      });
      expect(DELIVERED).toContain(result.status);
      if (result.status === 'SUCCEEDED' || result.status === 'PARTIAL') {
        expect(result.fulfilledAmount).toBeLessThanOrEqual(harness.amount);
      }
      const verification = await harness.provider.verify({ clientReference });
      expect(verification.status).not.toBe('NOT_FOUND');
      expect(providerReferenceOf(result)).toBe(
        'providerReference' in verification ? verification.providerReference : undefined,
      );
    });

    it('never delivers twice for one client reference', async () => {
      const request = {
        clientReference: newReference(),
        recipient: harness.recipient,
        amount: harness.amount,
      };
      const first = await harness.provider.fulfill(request);
      const before = harness.deliveryCount?.();
      const again = await harness.provider.fulfill(request);
      expect(again.status).toBe(first.status);
      expect(providerReferenceOf(again)).toBe(providerReferenceOf(first));
      if (before !== undefined) {
        expect(harness.deliveryCount?.()).toBe(before);
      }
    });

    it('refuses to reuse a client reference for a different request', async () => {
      const clientReference = newReference();
      await harness.provider.fulfill({
        clientReference,
        recipient: harness.recipient,
        amount: harness.amount,
      });
      const conflicting = await harness.provider.fulfill({
        clientReference,
        recipient: harness.recipient,
        amount: harness.amount + 1,
      });
      expect(conflicting).toMatchObject({
        status: 'PERMANENT_FAILURE',
        error: 'DUPLICATE_REFERENCE',
      });
    });

    it('answers NOT_FOUND for a reference it never received', async () => {
      expect(await harness.provider.verify({ clientReference: newReference() })).toEqual({
        status: 'NOT_FOUND',
      });
    });

    it('rejects an invalid amount without delivering anything', async () => {
      const clientReference = newReference();
      const result = await harness.provider.fulfill({
        clientReference,
        recipient: harness.recipient,
        amount: 0,
      });
      expect(result.status).toBe('PERMANENT_FAILURE');
      expect((await harness.provider.verify({ clientReference })).status).toBe('NOT_FOUND');
    });
  });
}
