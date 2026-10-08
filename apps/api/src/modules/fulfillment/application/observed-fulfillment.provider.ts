import { Logger } from '@nestjs/common';
import type {
  FulfillmentProvider,
  FulfillmentRecipient,
  FulfillmentRequest,
  FulfillmentResult,
  ProviderBalance,
  RecipientValidation,
  VerificationLookup,
  VerificationResult,
} from '../domain/fulfillment-provider';

/**
 * Logs every provider call the same way for every adapter: provider, operation, references,
 * outcome, duration and correlation id. Only identifiers and normalized outcomes are logged; the
 * recipient username and amounts stay out of the logs.
 */
export class ObservedFulfillmentProvider implements FulfillmentProvider {
  private readonly logger = new Logger('FulfillmentProvider');
  readonly code: string;

  constructor(private readonly inner: FulfillmentProvider) {
    this.code = inner.code;
  }

  getBalance(): Promise<ProviderBalance> {
    return this.observe('getBalance', {}, () => this.inner.getBalance());
  }

  validateRecipient(recipient: FulfillmentRecipient): Promise<RecipientValidation> {
    return this.observe('validateRecipient', {}, () => this.inner.validateRecipient(recipient));
  }

  fulfill(request: FulfillmentRequest): Promise<FulfillmentResult> {
    return this.observe(
      'fulfill',
      {
        clientReference: request.clientReference,
        correlationId: request.correlationId ?? undefined,
      },
      () => this.inner.fulfill(request),
    );
  }

  verify(lookup: VerificationLookup): Promise<VerificationResult> {
    return this.observe(
      'verify',
      {
        clientReference: lookup.clientReference,
        providerReference: lookup.providerReference ?? undefined,
        correlationId: lookup.correlationId ?? undefined,
      },
      () => this.inner.verify(lookup),
    );
  }

  private async observe<R extends { status: string; error?: string; providerReference?: string }>(
    operation: string,
    fields: Record<string, string | undefined>,
    call: () => Promise<R>,
  ): Promise<R> {
    const started = Date.now();
    const base = { event: 'fulfillment.provider_call', provider: this.code, operation, ...fields };
    try {
      const result = await call();
      this.logger.log({
        ...base,
        status: result.status,
        error: result.error,
        providerReference: result.providerReference ?? fields.providerReference,
        durationMs: Date.now() - started,
      });
      return result;
    } catch (error) {
      // An adapter bug or transport failure; the outcome of a fulfill is then unknown.
      this.logger.error({
        ...base,
        status: 'THREW',
        errorClass: error instanceof Error ? error.name : 'unknown',
        durationMs: Date.now() - started,
      });
      throw error;
    }
  }
}
