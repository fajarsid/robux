import type { ProviderErrorCode } from '../../../domain/fulfillment-provider';

export type MockDeliveryStatus = 'PENDING' | 'SUCCEEDED' | 'PARTIAL' | 'FAILED';

/** What the simulated provider remembers about one client reference. */
export interface MockDelivery {
  clientReference: string;
  providerReference: string;
  /** Null for digital delivery (no recipient). */
  recipientUsername: string | null;
  requestedAmount: number;
  fulfilledAmount: number;
  status: MockDeliveryStatus;
  error: ProviderErrorCode | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * In-memory record of simulated deliveries, so `verify` answers truthfully. One entry per client
 * reference; `record` returns the existing entry instead of creating a second one, which is what
 * makes the mock idempotent. Lives as long as the process; development and test only.
 */
export class MockFulfillmentLedger {
  private readonly byClientReference = new Map<string, MockDelivery>();
  private readonly byProviderReference = new Map<string, MockDelivery>();
  private sequence = 0;

  /** `MOCK` in tests; a per-process prefix in a running worker (see `configuredFulfillmentProviders`). */
  constructor(private readonly referencePrefix = 'MOCK') {}

  find(lookup: {
    clientReference: string;
    providerReference?: string | null;
  }): MockDelivery | null {
    return (
      this.byClientReference.get(lookup.clientReference) ??
      (lookup.providerReference ? this.byProviderReference.get(lookup.providerReference) : null) ??
      null
    );
  }

  findByProviderReference(providerReference: string): MockDelivery | null {
    return this.byProviderReference.get(providerReference) ?? null;
  }

  /** Synchronous on purpose: no other call can interleave between the check and the insert. */
  record(
    entry: Omit<MockDelivery, 'providerReference' | 'createdAt' | 'updatedAt'>,
    now: Date,
  ): { delivery: MockDelivery; created: boolean } {
    const existing = this.byClientReference.get(entry.clientReference);
    if (existing) {
      return { delivery: existing, created: false };
    }
    this.sequence += 1;
    const delivery: MockDelivery = {
      ...entry,
      providerReference: `${this.referencePrefix}-${String(this.sequence).padStart(6, '0')}`,
      createdAt: now,
      updatedAt: now,
    };
    this.byClientReference.set(delivery.clientReference, delivery);
    this.byProviderReference.set(delivery.providerReference, delivery);
    return { delivery, created: true };
  }

  size(): number {
    return this.byClientReference.size;
  }
}
