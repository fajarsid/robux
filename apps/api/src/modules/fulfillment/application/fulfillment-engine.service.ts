import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { FULFILLMENT_LEASE_MS } from '../domain/fulfillment-lease';
import { type PlanOutcome, planFulfillment } from '../domain/fulfillment-plan';
import {
  type AttemptSnapshot,
  FULFILLMENT_WORKFLOW_REPOSITORY,
  type FulfillmentWorkflow,
  type FulfillmentWorkflowRepository,
  WorkflowConflictError,
  type WorkflowTrace,
} from '../domain/fulfillment-workflow.repository';
import { FulfillmentAttemptExecutor, type StepResult } from './fulfillment-attempt.executor';
import { FulfillmentAttemptVerifier } from './fulfillment-attempt.verifier';

/** One delivery of the fulfillment job, as the engine needs to know it. */
export interface FulfillmentRun {
  eventId: string;
  correlationId: string | null;
  /** Total runs the job may have (its retry policy). */
  maxAttempts: number;
  /** No run follows this one: the engine must not leave anything waiting for a retry. */
  finalRun: boolean;
}

/**
 * Plan outcomes (NEXT_ALLOCATION is handled inside the run), plus:
 * NOT_ELIGIBLE: the order is not on the automatic fulfillment path (any more).
 * BUSY: another run holds the order's lease. CONFLICT: the state moved under this run.
 * Both mean "look again later"; nothing was written by this run.
 */
export type FulfillmentRunOutcome =
  PlanOutcome | 'NOT_ELIGIBLE' | 'ORDER_NOT_FOUND' | 'BUSY' | 'CONFLICT';

/** Safety bound; a routing plan has far fewer allocations than this. */
const MAX_ALLOCATIONS_PER_RUN = 20;

const LIVE_ATTEMPT_STATUSES = new Set(['PENDING', 'EXECUTING', 'VERIFYING', 'UNKNOWN']);

/**
 * Runs one step of an order's fulfillment (ARCHITECTURE.md §6.4) and persists its result. Every run
 * starts from PostgreSQL, so a retry, a duplicate job or a run after a crash all continue from
 * what was committed:
 *
 *   QUEUED / RETRYING     → PROCESSING, then execute
 *   PROCESSING            → a live attempt (crash mid-call) is verified; otherwise execute
 *   FULFILLMENT_PENDING   → verify the live attempt
 *
 * An unknown or pending attempt is only ever verified, never sent again.
 */
@Injectable()
export class FulfillmentEngine {
  private readonly logger = new Logger(FulfillmentEngine.name);

  constructor(
    @Inject(FULFILLMENT_WORKFLOW_REPOSITORY)
    private readonly workflows: FulfillmentWorkflowRepository,
    private readonly executor: FulfillmentAttemptExecutor,
    private readonly verifier: FulfillmentAttemptVerifier,
  ) {}

  async run(orderId: string, run: FulfillmentRun): Promise<FulfillmentRunOutcome> {
    const now = new Date();
    const token = randomUUID();
    const acquired = await this.workflows.acquire(orderId, {
      token,
      now,
      expiresAt: new Date(now.getTime() + FULFILLMENT_LEASE_MS),
    });
    const base = { orderId, eventId: run.eventId, correlationId: run.correlationId ?? undefined };
    if (acquired.kind !== 'ACQUIRED') {
      const outcome = acquired.kind;
      this.logger.log({ event: 'fulfillment.skipped', outcome, ...base, ...detailsOf(acquired) });
      return outcome;
    }

    const workflow = acquired.workflow;
    const trace: WorkflowTrace = { eventId: run.eventId, requestId: run.correlationId };
    try {
      return await this.step(workflow, run, trace);
    } catch (error) {
      if (error instanceof WorkflowConflictError) {
        this.logger.warn({ event: 'fulfillment.conflict', ...base, reason: error.message });
        return 'CONFLICT';
      }
      throw error;
    } finally {
      // No-op when the step committed (which releases the lease with its writes).
      await this.workflows.release(workflow.fulfillmentOrderId, token);
    }
  }

  private async step(
    workflow: FulfillmentWorkflow,
    run: FulfillmentRun,
    trace: WorkflowTrace,
  ): Promise<FulfillmentRunOutcome> {
    const live =
      workflow.latestAttempt && LIVE_ATTEMPT_STATUSES.has(workflow.latestAttempt.status)
        ? workflow.latestAttempt
        : null;

    switch (workflow.orderStatus) {
      case 'QUEUED':
      case 'RETRYING': {
        if (!(await this.workflows.start(workflow, trace))) {
          return 'CONFLICT';
        }
        this.logger.log({
          event: 'fulfillment.started',
          orderId: workflow.orderId,
          productLine: workflow.productLine,
          fulfillmentType: workflow.fulfillmentType,
          fulfillmentOrderId: workflow.fulfillmentOrderId,
          remainingAmount: workflow.remainingAmount,
          eventId: trace.eventId,
          correlationId: trace.requestId ?? undefined,
        });
        const processing = { ...workflow, orderStatus: 'PROCESSING' as const };
        return this.continueWith(
          processing,
          await this.record(processing, await this.executor.execute(processing, trace), run, trace),
          run,
          trace,
        );
      }
      case 'PROCESSING':
        return this.continueWith(
          workflow,
          await this.record(
            workflow,
            live
              ? await this.verifier.verify(workflow, live, trace)
              : await this.executor.execute(workflow, trace),
            run,
            trace,
          ),
          run,
          trace,
        );
      case 'FULFILLMENT_PENDING':
        if (!live) {
          this.logger.error({
            event: 'fulfillment.no_live_attempt',
            orderId: workflow.orderId,
            fulfillmentOrderId: workflow.fulfillmentOrderId,
          });
          return 'NOT_ELIGIBLE';
        }
        return this.record(workflow, await this.verifier.verify(workflow, live, trace), run, trace);
      default:
        return 'NOT_ELIGIBLE';
    }
  }

  /**
   * A multi-source plan: each allocation delivered in full lets the same run, still holding the
   * lease, execute the next one from fresh state, instead of spending a job retry on it.
   */
  private async continueWith(
    workflow: FulfillmentWorkflow,
    outcome: FulfillmentRunOutcome,
    run: FulfillmentRun,
    trace: WorkflowTrace,
  ): Promise<FulfillmentRunOutcome> {
    let current = workflow;
    for (let step = 0; outcome === 'NEXT_ALLOCATION'; step += 1) {
      if (step >= MAX_ALLOCATIONS_PER_RUN) {
        return 'CONFLICT';
      }
      current = await this.workflows.reload(current);
      outcome = await this.record(current, await this.executor.execute(current, trace), run, trace);
    }
    return outcome;
  }

  private async record(
    workflow: FulfillmentWorkflow,
    { attempt, allocation, resolution }: StepResult,
    run: FulfillmentRun,
    trace: WorkflowTrace,
  ): Promise<FulfillmentRunOutcome> {
    const plan = planFulfillment({
      orderStatus:
        workflow.orderStatus === 'FULFILLMENT_PENDING' ? 'FULFILLMENT_PENDING' : 'PROCESSING',
      fulfilledAmount: workflow.fulfilledAmount,
      remainingAmount: workflow.remainingAmount,
      attemptRequestedAmount: attempt?.requestedAmount ?? null,
      resolution,
      retriesUsed: workflow.retriesUsed,
      maxAttempts: run.maxAttempts,
      finalRun: run.finalRun,
    });
    await this.workflows.apply({
      workflow,
      attempt,
      allocation,
      resolution,
      plan,
      trace,
      now: new Date(),
    });

    const entry = {
      event: 'fulfillment.step_recorded',
      outcome: plan.outcome,
      resolution: resolution.kind,
      orderId: workflow.orderId,
      productLine: workflow.productLine,
      fulfillmentType: workflow.fulfillmentType,
      fulfillmentOrderId: workflow.fulfillmentOrderId,
      ...attemptFields(attempt),
      allocationId: allocation?.id,
      sourceId: allocation?.sourceId,
      releaseAllocations: plan.releaseAllocations,
      providerReference:
        resolution.kind === 'DELIVERED'
          ? resolution.providerReference
          : (resolution.providerReference ?? attempt?.providerReference ?? undefined),
      errorCode: resolution.kind === 'DELIVERED' ? undefined : (resolution.error ?? undefined),
      stopReason: plan.stopReason ?? undefined,
      deliveredAmount: plan.deliveredAmount,
      remainingAmount: workflow.remainingAmount - plan.deliveredAmount,
      eventId: trace.eventId,
      correlationId: trace.requestId ?? undefined,
    };
    if (plan.outcome === 'FAILED_PERMANENTLY' || plan.outcome === 'RECONCILIATION_REQUIRED') {
      this.logger.warn(entry);
    } else {
      this.logger.log(entry);
    }
    return plan.outcome;
  }
}

function attemptFields(attempt: AttemptSnapshot | null) {
  return attempt
    ? {
        attemptId: attempt.id,
        attemptNumber: attempt.attemptNumber,
        clientReference: attempt.clientReference,
        provider: attempt.provider,
      }
    : {};
}

function detailsOf(result: { kind: string; orderStatus?: string; method?: string }) {
  return result.kind === 'NOT_ELIGIBLE'
    ? { orderStatus: result.orderStatus, method: result.method }
    : {};
}
