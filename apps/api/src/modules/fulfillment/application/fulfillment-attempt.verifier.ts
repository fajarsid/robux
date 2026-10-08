import { Inject, Injectable } from '@nestjs/common';
import { resolveVerification } from '../domain/delivery-resolution';
import type { VerificationResult } from '../domain/fulfillment-provider';
import type {
  AttemptSnapshot,
  FulfillmentWorkflow,
  WorkflowTrace,
} from '../domain/fulfillment-workflow.repository';
import type { StepResult } from './fulfillment-attempt.executor';
import {
  FULFILLMENT_PROVIDER_REGISTRY,
  type FulfillmentProviderRegistry,
} from './fulfillment-provider.registry';

/**
 * Asks the provider what happened to a live attempt (pending, unknown, or cut off by a crash).
 * Never sends the request again: that is only allowed after the provider answers NOT_FOUND.
 */
@Injectable()
export class FulfillmentAttemptVerifier {
  constructor(
    @Inject(FULFILLMENT_PROVIDER_REGISTRY) private readonly registry: FulfillmentProviderRegistry,
  ) {}

  async verify(
    workflow: FulfillmentWorkflow,
    attempt: AttemptSnapshot,
    trace: WorkflowTrace,
  ): Promise<StepResult> {
    // The provider that received the request answers for it, even if configuration changed since.
    const provider = this.registry.get(attempt.provider);
    let result: VerificationResult;
    try {
      result = await provider.verify({
        clientReference: attempt.clientReference,
        providerReference: attempt.providerReference,
        correlationId: trace.requestId,
      });
    } catch {
      result = { status: 'UNAVAILABLE', error: 'UNAVAILABLE' };
    }
    return {
      attempt,
      // The reservation behind the attempt stays held until verification settles it.
      allocation: workflow.openAllocations.find((a) => a.id === attempt.allocationId) ?? null,
      resolution: resolveVerification(result, {
        requestedAmount: attempt.requestedAmount,
        // EXECUTING means a run stopped mid-call: as unknown as a timeout.
        status: attempt.status === 'VERIFYING' ? 'VERIFYING' : 'UNKNOWN',
        providerReference: attempt.providerReference,
      }),
    };
  }
}
