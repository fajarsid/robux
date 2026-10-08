import type {
  FulfillmentProvider,
  FulfillmentRecipient,
  FulfillmentRequest,
  FulfillmentResult,
  ProviderBalance,
  RecipientValidation,
  VerificationLookup,
  VerificationResult,
} from '../../../domain/fulfillment-provider';
import { type MockDelivery, MockFulfillmentLedger } from './mock-fulfillment.ledger';
import { MockRecipient, MockScenario } from './mock-scenario';

export const MOCK_PROVIDER_CODE = 'mock';

export interface MockProviderOptions {
  balance: bigint;
  scenario: MockScenario;
  now?: () => Date;
  /**
   * Prefix of the provider references the mock hands out. The ledger lives in memory, so a
   * restarted worker counts from 1 again; a per-process prefix keeps references unique like a real
   * provider's, which `UNIQUE(provider, external_reference)` on attempts relies on.
   */
  referencePrefix?: string;
}

const MAX_REFERENCE_LENGTH = 128;

/**
 * Simulated fulfillment provider for development and tests. It delivers nothing to anyone: no
 * network, no external supplier, no browser. Behaviour is fixed by the current scenario (for new client
 * references) and by the fixed recipients in `MockRecipient`; the ledger makes it idempotent and
 * lets `verify` report what "happened". MOCK / NOT PRODUCTION SUPPLIER.
 */
export class MockFulfillmentProvider implements FulfillmentProvider {
  readonly code = MOCK_PROVIDER_CODE;
  private readonly ledger: MockFulfillmentLedger;
  private balance: bigint;
  private scenario: MockScenario;
  private readonly now: () => Date;

  constructor(options: MockProviderOptions) {
    this.ledger = new MockFulfillmentLedger(options.referencePrefix);
    this.balance = options.balance;
    this.scenario = options.scenario;
    this.now = options.now ?? (() => new Date());
  }

  async getBalance(): Promise<ProviderBalance> {
    if (this.scenario === MockScenario.UNAVAILABLE) {
      return { status: 'UNAVAILABLE', error: 'UNAVAILABLE' };
    }
    return { status: 'AVAILABLE', units: this.balance };
  }

  async validateRecipient(recipient: FulfillmentRecipient): Promise<RecipientValidation> {
    const verdict = this.recipientVerdict(recipient);
    if (verdict === 'UNAVAILABLE') {
      return { status: 'UNAVAILABLE', error: 'UNAVAILABLE' };
    }
    return verdict === 'INVALID'
      ? { status: 'INVALID' }
      : { status: 'VALID', externalUserId: recipient.externalUserId };
  }

  async fulfill(request: FulfillmentRequest): Promise<FulfillmentResult> {
    if (
      !request.clientReference ||
      request.clientReference.length > MAX_REFERENCE_LENGTH ||
      !Number.isInteger(request.amount) ||
      request.amount <= 0
    ) {
      return { status: 'PERMANENT_FAILURE', error: 'REJECTED' };
    }
    if (this.scenario === MockScenario.UNAVAILABLE) {
      return { status: 'RETRYABLE_FAILURE', error: 'UNAVAILABLE' };
    }

    const existing = this.ledger.find(request);
    if (existing) {
      // A repeated reference never delivers again; a conflicting one is refused.
      return existing.requestedAmount === request.amount &&
        existing.recipientUsername === (request.recipient?.identifier ?? null)
        ? resultOf(existing)
        : { status: 'PERMANENT_FAILURE', error: 'DUPLICATE_REFERENCE' };
    }

    const verdict = this.recipientVerdict(request.recipient);
    if (verdict === 'UNAVAILABLE') {
      return { status: 'RETRYABLE_FAILURE', error: 'UNAVAILABLE' };
    }
    if (this.scenario === MockScenario.RETRYABLE_FAILURE) {
      return { status: 'RETRYABLE_FAILURE', error: 'UNAVAILABLE' };
    }
    if (verdict === 'INVALID') {
      return resultOf(this.recordFailure(request, 'INVALID_RECIPIENT'));
    }
    if (this.scenario === MockScenario.PERMANENT_FAILURE) {
      return resultOf(this.recordFailure(request, 'REJECTED'));
    }
    if (BigInt(request.amount) > this.balance) {
      return { status: 'RETRYABLE_FAILURE', error: 'INSUFFICIENT_BALANCE' };
    }
    return this.deliver(request);
  }

  async verify(lookup: VerificationLookup): Promise<VerificationResult> {
    if (this.scenario === MockScenario.UNAVAILABLE) {
      return { status: 'UNAVAILABLE', error: 'UNAVAILABLE' };
    }
    const delivery = this.ledger.find(lookup);
    if (!delivery) {
      return { status: 'NOT_FOUND' };
    }
    switch (delivery.status) {
      case 'FAILED':
        return {
          status: 'FAILED',
          providerReference: delivery.providerReference,
          error: delivery.error ?? 'UNKNOWN',
        };
      case 'PENDING':
        return { status: 'PENDING', providerReference: delivery.providerReference };
      default:
        return {
          status: delivery.status,
          providerReference: delivery.providerReference,
          fulfilledAmount: delivery.fulfilledAmount,
        };
    }
  }

  /** Test and development control: behaviour for client references not seen before. */
  setScenario(scenario: MockScenario): void {
    this.scenario = scenario;
  }

  setBalance(robux: bigint): void {
    this.balance = robux;
  }

  /**
   * Completes a PENDING delivery the way a provider would later report it. The Robux were held
   * when the request was accepted; a failure gives them back.
   */
  settle(providerReference: string, outcome: 'SUCCEEDED' | 'PARTIAL' | 'FAILED'): void {
    const delivery = this.ledger.findByProviderReference(providerReference);
    if (!delivery || delivery.status !== 'PENDING') {
      throw new Error(`No pending mock delivery ${providerReference}`);
    }
    const delivered =
      outcome === 'SUCCEEDED'
        ? delivery.requestedAmount
        : outcome === 'PARTIAL'
          ? partialAmount(delivery.requestedAmount)
          : 0;
    this.balance += BigInt(delivery.requestedAmount - delivered);
    delivery.status = outcome;
    delivery.fulfilledAmount = delivered;
    delivery.error = outcome === 'FAILED' ? 'REJECTED' : null;
    delivery.updatedAt = this.now();
  }

  /** Simulated deliveries recorded so far (one per distinct client reference). */
  deliveryCount(): number {
    return this.ledger.size();
  }

  private deliver(request: FulfillmentRequest): FulfillmentResult {
    const scenario = this.scenario;
    const fulfilledAmount =
      scenario === MockScenario.PENDING
        ? 0
        : scenario === MockScenario.PARTIAL
          ? partialAmount(request.amount)
          : request.amount;
    const { delivery } = this.ledger.record(
      {
        clientReference: request.clientReference,
        recipientUsername: request.recipient?.identifier ?? null,
        requestedAmount: request.amount,
        fulfilledAmount,
        status:
          scenario === MockScenario.PENDING
            ? 'PENDING'
            : scenario === MockScenario.PARTIAL
              ? 'PARTIAL'
              : 'SUCCEEDED',
        error: null,
      },
      this.now(),
    );
    // A pending delivery holds the whole amount until it settles.
    this.balance -= BigInt(scenario === MockScenario.PENDING ? request.amount : fulfilledAmount);
    if (scenario === MockScenario.SUCCEEDED_BUT_TIMED_OUT) {
      return { status: 'UNKNOWN', error: 'TIMEOUT' };
    }
    return resultOf(delivery);
  }

  private recordFailure(request: FulfillmentRequest, error: 'INVALID_RECIPIENT' | 'REJECTED') {
    return this.ledger.record(
      {
        clientReference: request.clientReference,
        recipientUsername: request.recipient?.identifier ?? null,
        requestedAmount: request.amount,
        fulfilledAmount: 0,
        status: 'FAILED',
        error,
      },
      this.now(),
    ).delivery;
  }

  /** No recipient (digital delivery) has nothing to check, so only an outage can stop it. */
  private recipientVerdict(
    recipient: FulfillmentRecipient | null,
  ): 'VALID' | 'INVALID' | 'UNAVAILABLE' {
    if (
      this.scenario === MockScenario.UNAVAILABLE ||
      recipient?.identifier === MockRecipient.UNAVAILABLE
    ) {
      return 'UNAVAILABLE';
    }
    if (
      (recipient !== null && this.scenario === MockScenario.INVALID_RECIPIENT) ||
      recipient?.identifier === MockRecipient.INVALID
    ) {
      return 'INVALID';
    }
    return 'VALID';
  }
}

function partialAmount(requested: number): number {
  return Math.floor(requested / 2);
}

function resultOf(delivery: MockDelivery): FulfillmentResult {
  switch (delivery.status) {
    case 'PENDING':
      return { status: 'PENDING', providerReference: delivery.providerReference };
    case 'FAILED':
      return {
        status: 'PERMANENT_FAILURE',
        error: delivery.error ?? 'UNKNOWN',
        providerReference: delivery.providerReference,
      };
    default:
      return {
        status: delivery.status,
        providerReference: delivery.providerReference,
        fulfilledAmount: delivery.fulfilledAmount,
      };
  }
}
