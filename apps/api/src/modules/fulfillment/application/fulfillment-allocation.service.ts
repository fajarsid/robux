import { Inject, Injectable, Logger } from '@nestjs/common';
import { type RoutingDecision, planRouting } from '../../inventory/domain/routing';
import {
  SOURCE_CANDIDATE_READER,
  type SourceCandidateReader,
} from '../../inventory/domain/source-candidate.reader';
import { ReservationConflictError } from '../../inventory/domain/reservation-conflict.error';
import {
  type AllocationSnapshot,
  FULFILLMENT_WORKFLOW_REPOSITORY,
  type FulfillmentWorkflow,
  type FulfillmentWorkflowRepository,
  type WorkflowTrace,
} from '../domain/fulfillment-workflow.repository';
import {
  FULFILLMENT_PROVIDER_REGISTRY,
  type FulfillmentProviderRegistry,
} from './fulfillment-provider.registry';

export type AllocationOutcome =
  | { kind: 'ALLOCATED'; allocation: AllocationSnapshot }
  | { kind: 'NO_ELIGIBLE_SOURCE'; reason: string };

/** Re-routes after a lost race for inventory; beyond this the step fails as retryable. */
const MAX_ROUTING_ROUNDS = 3;

/**
 * Where and how much (Phase 10, ADR-007): hands the engine the allocation to execute next. An open
 * allocation of this order is always used first, so a retry, a verification or the remainder of a
 * partial delivery never reserves inventory twice. Only when nothing is open is the remaining
 * amount routed and reserved, atomically, against current balances.
 */
@Injectable()
export class FulfillmentAllocationService {
  private readonly logger = new Logger(FulfillmentAllocationService.name);

  constructor(
    @Inject(FULFILLMENT_WORKFLOW_REPOSITORY)
    private readonly workflows: FulfillmentWorkflowRepository,
    @Inject(SOURCE_CANDIDATE_READER) private readonly sources: SourceCandidateReader,
    @Inject(FULFILLMENT_PROVIDER_REGISTRY) private readonly registry: FulfillmentProviderRegistry,
  ) {}

  async allocationFor(
    workflow: FulfillmentWorkflow,
    trace: WorkflowTrace,
  ): Promise<AllocationOutcome> {
    const open = workflow.openAllocations.find((a) => a.amount > a.consumedAmount);
    if (open) {
      return { kind: 'ALLOCATED', allocation: open };
    }

    let decision: RoutingDecision | null = null;
    for (let round = 1; round <= MAX_ROUTING_ROUNDS; round += 1) {
      const candidates = (await this.sources.candidates(workflow.productLine)).map((source) => ({
        ...source,
        providerConfigured: this.registry.has(source.provider),
      }));
      decision = planRouting(candidates, workflow.remainingAmount);
      if (decision.kind === 'NO_ELIGIBLE_SOURCE') {
        break;
      }
      try {
        const reserved = await this.workflows.reserve(workflow, decision, trace);
        this.logger.log({
          event: 'inventory.allocation_reserved',
          orderId: workflow.orderId,
          fulfillmentOrderId: workflow.fulfillmentOrderId,
          allocations: reserved.map((a) => ({
            allocationId: a.id,
            sourceId: a.sourceId,
            amount: a.amount,
          })),
          strategy: decision.record.strategy,
          reason: decision.record.reason,
          round,
          eventId: trace.eventId,
          correlationId: trace.requestId ?? undefined,
        });
        return { kind: 'ALLOCATED', allocation: reserved[0]! };
      } catch (error) {
        if (!(error instanceof ReservationConflictError)) {
          throw error;
        }
        // Another order took the balance between the snapshot and the reservation: route again
        // on fresh balances instead of trusting the stale plan.
        this.logger.log({
          event: 'inventory.reservation_conflict',
          orderId: workflow.orderId,
          sourceId: error.sourceId,
          round,
        });
      }
    }

    const reason =
      decision?.kind === 'NO_ELIGIBLE_SOURCE' ? decision.reason : 'RESERVATION_CONTENTION';
    this.logger.warn({
      event: 'inventory.routing_failed',
      orderId: workflow.orderId,
      fulfillmentOrderId: workflow.fulfillmentOrderId,
      amount: workflow.remainingAmount,
      reason,
      eventId: trace.eventId,
      correlationId: trace.requestId ?? undefined,
    });
    return { kind: 'NO_ELIGIBLE_SOURCE', reason };
  }
}
