import type {
  FulfillmentAttemptStatus,
  FulfillmentMethod,
  OrderStatus,
} from '../../../generated/prisma/enums';
import type { FulfillmentTypeName, ProductLineName } from '@robux/shared';
import type { PlannedAllocation, RoutingDecisionRecord } from '../../inventory/domain/routing';
import type { DeliveryResolution } from './delivery-resolution';
import type { FulfillmentPlan } from './fulfillment-plan';
import type { FulfillmentRecipient } from './fulfillment-provider';

/** Order statuses the engine acts on; any other status means the workflow is not ours to run. */
export const ENGINE_ORDER_STATUSES: readonly OrderStatus[] = [
  'QUEUED',
  'RETRYING',
  'PROCESSING',
  'FULFILLMENT_PENDING',
];

export interface AttemptSnapshot {
  id: string;
  attemptNumber: number;
  provider: string;
  clientReference: string;
  requestedAmount: number;
  status: FulfillmentAttemptStatus;
  providerReference: string | null;
  allocationId: string | null;
}

/** Reserved inventory on one source for this order (inventory module, ADR-007). */
export interface AllocationSnapshot {
  id: string;
  sourceId: string;
  provider: string;
  amount: number;
  consumedAmount: number;
}

/** Authoritative state of one order's fulfillment, read from PostgreSQL at the start of a run. */
export interface FulfillmentWorkflow {
  orderId: string;
  orderStatus: OrderStatus;
  method: FulfillmentMethod;
  /** Snapshot taken at purchase (ADR-009): selects the strategy and the sources that may serve. */
  productLine: ProductLineName;
  fulfillmentType: FulfillmentTypeName;
  /** Null for digital delivery. */
  recipient: FulfillmentRecipient | null;
  fulfillmentOrderId: string;
  requestedAmount: number;
  fulfilledAmount: number;
  remainingAmount: number;
  /** Automatic retries already made (transitions to RETRYING). */
  retriesUsed: number;
  /** Highest attempt number so far (0 before the first attempt). */
  lastAttemptNumber: number;
  /** Distinct client references used so far. */
  referencesUsed: number;
  latestAttempt: AttemptSnapshot | null;
  /** RESERVED allocations, oldest first; their unconsumed amounts are still held for this order. */
  openAllocations: AllocationSnapshot[];
  leaseToken: string;
}

export type AcquireResult =
  | { kind: 'ACQUIRED'; workflow: FulfillmentWorkflow }
  /** Another run holds the lease; it is still within its time. */
  | { kind: 'BUSY' }
  /** Not (or no longer) on the automatic fulfillment path: finished, refunded, gamepass, ... */
  | { kind: 'NOT_ELIGIBLE'; orderStatus: OrderStatus; method: FulfillmentMethod }
  | { kind: 'ORDER_NOT_FOUND' };

/** Correlation carried into history rows. */
export interface WorkflowTrace {
  eventId: string;
  requestId: string | null;
}

export interface OpenAttempt {
  fulfillmentOrderId: string;
  leaseToken: string;
  attemptNumber: number;
  provider: string;
  allocationId: string;
  clientReference: string;
  requestedAmount: number;
  trace: WorkflowTrace;
}

export interface ApplyPlan {
  workflow: FulfillmentWorkflow;
  /** The live attempt the resolution belongs to, with the status it had when it was read. */
  attempt: AttemptSnapshot | null;
  /** The allocation this step used, if routing got that far. */
  allocation: AllocationSnapshot | null;
  resolution: DeliveryResolution;
  plan: FulfillmentPlan;
  trace: WorkflowTrace;
  now: Date;
}

/**
 * The lease was taken over (this run outlived it) or the order/attempt changed under us. Nothing
 * of the plan was written; the run is abandoned and the next one starts from fresh state.
 */
export class WorkflowConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowConflictError';
  }
}

/**
 * Persistence of the fulfillment workflow (ARCHITECTURE.md §6.4). Every method that changes state
 * is one transaction; order transitions go through the orders module's single transition writer.
 */
export interface FulfillmentWorkflowRepository {
  /**
   * For an order the engine works on (see `ENGINE_ORDER_STATUSES`), creates the fulfillment order
   * on first use (amount from the order items), then takes the lease if it is free or expired, and
   * returns the state it guards.
   */
  acquire(
    orderId: string,
    lease: { token: string; now: Date; expiresAt: Date },
  ): Promise<AcquireResult>;
  /** QUEUED or RETRYING → PROCESSING (FULFILLMENT_STARTED). False if the order moved first. */
  start(workflow: FulfillmentWorkflow, trace: WorkflowTrace): Promise<boolean>;
  /**
   * Reserves a routing plan for the order's remaining amount: allocations, source balances, ledger
   * and low-balance events in one transaction, only while this run holds the lease and the order
   * has no open allocation (allocation is idempotent per workflow). Throws the inventory module's
   * ReservationConflictError when a source no longer has the planned balance; nothing is written.
   */
  reserve(
    workflow: FulfillmentWorkflow,
    plan: { allocations: readonly PlannedAllocation[]; record: RoutingDecisionRecord },
    trace: WorkflowTrace,
  ): Promise<AllocationSnapshot[]>;
  /** Fresh state for a run that keeps its lease (next allocation of the same plan). */
  reload(workflow: FulfillmentWorkflow): Promise<FulfillmentWorkflow>;
  /** Records the attempt as EXECUTING before the provider is called (crash ⇒ verify, never re-send). */
  openAttempt(input: OpenAttempt): Promise<AttemptSnapshot>;
  /**
   * Attempt, allocation consumption or release, source health, amounts, order transitions, history
   * and outbox events, and the lease release (kept for NEXT_ALLOCATION), together.
   */
  apply(input: ApplyPlan): Promise<void>;
  /** Gives the lease back if this run still holds it. */
  release(fulfillmentOrderId: string, leaseToken: string): Promise<void>;
}

export const FULFILLMENT_WORKFLOW_REPOSITORY = Symbol('FULFILLMENT_WORKFLOW_REPOSITORY');
