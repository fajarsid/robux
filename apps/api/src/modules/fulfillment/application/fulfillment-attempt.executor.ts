import { Inject, Injectable } from '@nestjs/common';
import { nextClientReference } from '../domain/client-reference';
import { type DeliveryResolution, resolveFulfillResult } from '../domain/delivery-resolution';
import { fulfillmentStrategyFor } from '../domain/fulfillment-strategy';
import type {
  FulfillmentProvider,
  FulfillmentRecipient,
  FulfillmentResult,
  ProviderBalance,
  RecipientValidation,
} from '../domain/fulfillment-provider';
import {
  type AllocationSnapshot,
  type AttemptSnapshot,
  FULFILLMENT_WORKFLOW_REPOSITORY,
  type FulfillmentWorkflow,
  type FulfillmentWorkflowRepository,
  type WorkflowTrace,
} from '../domain/fulfillment-workflow.repository';
import { FulfillmentAllocationService } from './fulfillment-allocation.service';
import {
  FULFILLMENT_PROVIDER_REGISTRY,
  type FulfillmentProviderRegistry,
} from './fulfillment-provider.registry';

export interface StepResult {
  /** The attempt the resolution belongs to; null when the run stopped before sending anything. */
  attempt: AttemptSnapshot | null;
  /** The allocation the step used; null when routing found no source. */
  allocation: AllocationSnapshot | null;
  resolution: DeliveryResolution;
}

/**
 * Executes the next allocation once. The order's fulfillment type selects the strategy, which
 * gives the delivery target; the allocation's source names the provider (through the registry),
 * which checks the recipient (if the strategy asks) and its own balance; then one attempt for the
 * allocation's unconsumed amount is recorded with its idempotency reference before the call.
 */
@Injectable()
export class FulfillmentAttemptExecutor {
  constructor(
    @Inject(FULFILLMENT_WORKFLOW_REPOSITORY)
    private readonly workflows: FulfillmentWorkflowRepository,
    @Inject(FULFILLMENT_PROVIDER_REGISTRY) private readonly registry: FulfillmentProviderRegistry,
    private readonly allocations: FulfillmentAllocationService,
  ) {}

  async execute(workflow: FulfillmentWorkflow, trace: WorkflowTrace): Promise<StepResult> {
    const strategy = fulfillmentStrategyFor(workflow.fulfillmentType);
    const target = strategy.targetOf(workflow);
    if (!target.ok) {
      // Checked before anything is reserved: such an order cannot be delivered at all.
      return {
        attempt: null,
        allocation: null,
        resolution: notDelivered(false, 'INVALID_RECIPIENT'),
      };
    }
    const allocated = await this.allocations.allocationFor(workflow, trace);
    if (allocated.kind === 'NO_ELIGIBLE_SOURCE') {
      return {
        attempt: null,
        allocation: null,
        resolution: notDelivered(true, 'NO_ELIGIBLE_SOURCE'),
      };
    }
    const allocation = allocated.allocation;
    // The source names the provider; the registry never substitutes another one.
    const provider = this.registry.get(allocation.provider);
    const amount = allocation.amount - allocation.consumedAmount;
    const stopped = (retryable: boolean, error: Parameters<typeof notDelivered>[1]) => ({
      attempt: null,
      allocation,
      resolution: notDelivered(retryable, error),
    });

    const validation =
      strategy.validatesRecipient && target.recipient
        ? await validateSafely(provider, target.recipient)
        : ({ status: 'VALID', externalUserId: null } as const);
    if (validation.status === 'INVALID') {
      return stopped(false, 'INVALID_RECIPIENT');
    }
    if (validation.status === 'UNAVAILABLE') {
      return stopped(true, validation.error);
    }
    // Our ledger decides reservations; the provider stays the authority on its real balance.
    const balance = await balanceSafely(provider);
    if (balance.status === 'UNAVAILABLE') {
      return stopped(true, balance.error);
    }
    if (balance.units < BigInt(amount)) {
      return stopped(true, 'INSUFFICIENT_BALANCE');
    }

    const attempt = await this.workflows.openAttempt({
      fulfillmentOrderId: workflow.fulfillmentOrderId,
      leaseToken: workflow.leaseToken,
      attemptNumber: workflow.lastAttemptNumber + 1,
      provider: allocation.provider,
      allocationId: allocation.id,
      clientReference: nextClientReference(workflow, amount),
      requestedAmount: amount,
      trace,
    });
    let result: FulfillmentResult;
    try {
      // Only what delivery needs: reference, recipient, amount. Never contact data or tokens.
      result = await provider.fulfill({
        clientReference: attempt.clientReference,
        recipient: target.recipient && {
          ...target.recipient,
          externalUserId: validation.externalUserId ?? target.recipient.externalUserId,
        },
        amount,
        correlationId: trace.requestId,
      });
    } catch {
      // The request may have reached the provider: unknown, settled by verification only.
      result = { status: 'UNKNOWN', error: 'UNKNOWN' };
    }
    return { attempt, allocation, resolution: resolveFulfillResult(result, amount) };
  }
}

function notDelivered(
  retryable: boolean,
  error: Extract<DeliveryResolution, { kind: 'NOT_DELIVERED' }>['error'],
): DeliveryResolution {
  return { kind: 'NOT_DELIVERED', retryable, error, providerReference: null };
}

async function validateSafely(
  provider: FulfillmentProvider,
  recipient: FulfillmentRecipient,
): Promise<RecipientValidation> {
  try {
    return await provider.validateRecipient(recipient);
  } catch {
    return { status: 'UNAVAILABLE', error: 'UNAVAILABLE' };
  }
}

async function balanceSafely(provider: FulfillmentProvider): Promise<ProviderBalance> {
  try {
    return await provider.getBalance();
  } catch {
    return { status: 'UNAVAILABLE', error: 'UNAVAILABLE' };
  }
}
