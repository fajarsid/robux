import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import type { FulfillmentAttemptStatus } from '../../../generated/prisma/enums';
import { OrderEvent } from '../../orders/domain/order-events';
import type { PlannedAllocation, RoutingDecisionRecord } from '../../inventory/domain/routing';
import {
  consumeAllocation,
  recordProviderOutcome,
  releaseAllocation,
  reserveAllocations,
} from '../../inventory/infrastructure/inventory-ledger.writer';
import { writeOrderTransition } from '../../orders/infrastructure/order-transition.writer';
import type { FulfillmentFailureCode } from '../domain/delivery-resolution';
import { FULFILLMENT_LEASE_MS } from '../domain/fulfillment-lease';
import {
  type AcquireResult,
  type AllocationSnapshot,
  type ApplyPlan,
  type AttemptSnapshot,
  ENGINE_ORDER_STATUSES,
  type FulfillmentWorkflow,
  type FulfillmentWorkflowRepository,
  type OpenAttempt,
  WorkflowConflictError,
  type WorkflowTrace,
} from '../domain/fulfillment-workflow.repository';

type Tx = Prisma.TransactionClient;

const ATTEMPT_SELECT = {
  id: true,
  attemptNumber: true,
  provider: true,
  clientReference: true,
  requestedAmount: true,
  status: true,
  externalReference: true,
  allocationId: true,
} as const;

/** Provider-side failures that count against a source's health (one alone never disables it). */
const PROVIDER_FAILURES: ReadonlySet<FulfillmentFailureCode> = new Set([
  'UNAVAILABLE',
  'TIMEOUT',
  'RATE_LIMITED',
]);

const TERMINAL_ATTEMPT_STATUSES: readonly FulfillmentAttemptStatus[] = [
  'SUCCEEDED',
  'PARTIAL',
  'FAILED_RETRYABLE',
  'FAILED_PERMANENT',
];

/** Rolls a transaction back when a conditional write matched nothing. */
class NotApplied extends Error {}

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

@Injectable()
export class PrismaFulfillmentWorkflowRepository implements FulfillmentWorkflowRepository {
  constructor(private readonly prisma: PrismaService) {}

  async acquire(
    orderId: string,
    lease: { token: string; now: Date; expiresAt: Date },
  ): Promise<AcquireResult> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        status: true,
        fulfillmentMethod: true,
        items: { select: { robuxAmount: true, quantity: true } },
      },
    });
    if (!order) {
      return { kind: 'ORDER_NOT_FOUND' };
    }
    // Gamepass delivery is its own flow (Phase 12); this engine only sends instant Robux.
    if (!ENGINE_ORDER_STATUSES.includes(order.status) || order.fulfillmentMethod !== 'INSTANT') {
      return { kind: 'NOT_ELIGIBLE', orderStatus: order.status, method: order.fulfillmentMethod };
    }
    // The amount comes from the order's item snapshots, never from the event.
    const requestedAmount = order.items.reduce((sum, i) => sum + i.robuxAmount * i.quantity, 0);
    // UNIQUE(order_id) makes concurrent first runs create one row.
    await this.prisma.fulfillmentOrder.createMany({
      data: {
        orderId,
        method: order.fulfillmentMethod,
        requestedAmount,
        remainingAmount: requestedAmount,
      },
      skipDuplicates: true,
    });

    const { count } = await this.prisma.fulfillmentOrder.updateMany({
      where: {
        orderId,
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: lease.now } }],
      },
      data: { leaseToken: lease.token, leaseExpiresAt: lease.expiresAt },
    });
    if (count === 0) {
      return { kind: 'BUSY' };
    }
    return { kind: 'ACQUIRED', workflow: await this.load(orderId, lease.token) };
  }

  async start(workflow: FulfillmentWorkflow, trace: WorkflowTrace): Promise<boolean> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.holdLease(tx, workflow.fulfillmentOrderId, workflow.leaseToken, {
          status: 'IN_PROGRESS',
        });
        const applied = await writeOrderTransition(tx, {
          orderId: workflow.orderId,
          from: workflow.orderStatus,
          to: 'PROCESSING',
          actorType: 'SYSTEM',
          reason: 'Pengiriman Robux dimulai',
          metadata: { eventId: trace.eventId, fulfillmentOrderId: workflow.fulfillmentOrderId },
          requestId: trace.requestId ?? undefined,
          outboxEventType: OrderEvent.FULFILLMENT_STARTED,
        });
        if (!applied) {
          throw new NotApplied();
        }
      });
      return true;
    } catch (error) {
      if (error instanceof NotApplied) {
        return false;
      }
      throw error;
    }
  }

  async reserve(
    workflow: FulfillmentWorkflow,
    plan: { allocations: readonly PlannedAllocation[]; record: RoutingDecisionRecord },
    trace: WorkflowTrace,
  ): Promise<AllocationSnapshot[]> {
    const planned = plan.allocations.reduce((sum, a) => sum + a.amount, 0);
    if (planned !== workflow.remainingAmount) {
      throw new Error(`Routing plan covers ${planned}, order needs ${workflow.remainingAmount}`);
    }
    return this.prisma.$transaction(async (tx) => {
      // The lease update locks the fulfillment order row: no other reservation for this order can
      // run until this transaction ends, so the "nothing open" check below cannot race.
      await this.holdLease(tx, workflow.fulfillmentOrderId, workflow.leaseToken, {});
      const open = await tx.fulfillmentAllocation.count({
        where: { fulfillmentOrderId: workflow.fulfillmentOrderId, status: 'RESERVED' },
      });
      if (open > 0) {
        throw new WorkflowConflictError(
          `Fulfillment ${workflow.fulfillmentOrderId} already has an open allocation`,
        );
      }
      return reserveAllocations(tx, {
        fulfillmentOrderId: workflow.fulfillmentOrderId,
        allocations: plan.allocations,
        record: plan.record,
        requestId: trace.requestId,
      });
    });
  }

  reload(workflow: FulfillmentWorkflow): Promise<FulfillmentWorkflow> {
    return this.load(workflow.orderId, workflow.leaseToken);
  }

  async openAttempt(input: OpenAttempt): Promise<AttemptSnapshot> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.holdLease(tx, input.fulfillmentOrderId, input.leaseToken, {});
        const attempt = await tx.fulfillmentAttempt.create({
          data: {
            fulfillmentOrderId: input.fulfillmentOrderId,
            attemptNumber: input.attemptNumber,
            provider: input.provider,
            allocationId: input.allocationId,
            clientReference: input.clientReference,
            requestedAmount: input.requestedAmount,
            status: 'EXECUTING',
            startedAt: new Date(),
          },
          select: ATTEMPT_SELECT,
        });
        await tx.fulfillmentAttemptStatusHistory.create({
          data: {
            attemptId: attempt.id,
            toStatus: 'EXECUTING',
            actorType: 'SYSTEM',
            reason: 'Permintaan dikirim ke penyedia',
            metadata: {
              eventId: input.trace.eventId,
              clientReference: input.clientReference,
              allocationId: input.allocationId,
            },
            requestId: input.trace.requestId,
          },
        });
        return snapshotOf(attempt);
      });
    } catch (error) {
      // "One live attempt per fulfillment order": another run opened one first.
      if (isUniqueViolation(error)) {
        throw new WorkflowConflictError('Another attempt is already live for this order');
      }
      throw error;
    }
  }

  async apply({
    workflow,
    attempt,
    allocation,
    resolution,
    plan,
    trace,
    now,
  }: ApplyPlan): Promise<void> {
    const providerReference =
      resolution.kind === 'DELIVERED'
        ? resolution.providerReference
        : (resolution.providerReference ?? attempt?.providerReference ?? null);
    const errorCode = resolution.kind === 'DELIVERED' ? null : resolution.error;

    const continues = plan.outcome === 'NEXT_ALLOCATION';

    await this.prisma.$transaction(async (tx) => {
      await this.holdLease(tx, workflow.fulfillmentOrderId, workflow.leaseToken, {
        fulfilledAmount: { increment: plan.deliveredAmount },
        remainingAmount: { decrement: plan.deliveredAmount },
        status: plan.fulfillmentOrderStatus,
        completedAt: plan.fulfillmentOrderStatus === 'FULFILLED' ? now : undefined,
        // The run is over and the next one takes the lease afresh, unless this run goes on to the
        // next allocation of the plan.
        ...(continues
          ? { leaseExpiresAt: new Date(now.getTime() + FULFILLMENT_LEASE_MS) }
          : { leaseToken: null, leaseExpiresAt: null }),
      });

      await this.settleInventory(tx, { workflow, allocation, resolution, plan, trace });

      if (attempt && plan.attemptStatus) {
        const { count } = await tx.fulfillmentAttempt.updateMany({
          where: { id: attempt.id, status: attempt.status },
          data: {
            status: plan.attemptStatus,
            fulfilledAmount: plan.deliveredAmount,
            externalReference: providerReference,
            errorCode,
            completedAt: TERMINAL_ATTEMPT_STATUSES.includes(plan.attemptStatus) ? now : null,
          },
        });
        if (count === 0) {
          throw new WorkflowConflictError(`Attempt ${attempt.id} changed concurrently`);
        }
        if (plan.attemptStatus !== attempt.status) {
          await tx.fulfillmentAttemptStatusHistory.create({
            data: {
              attemptId: attempt.id,
              fromStatus: attempt.status,
              toStatus: plan.attemptStatus,
              actorType: 'FULFILLMENT_PROVIDER',
              reason: resolution.kind,
              metadata: {
                eventId: trace.eventId,
                providerReference,
                errorCode,
                fulfilledAmount: plan.deliveredAmount,
              },
              requestId: trace.requestId,
            },
          });
        }
      }

      const metadata = {
        eventId: trace.eventId,
        fulfillmentOrderId: workflow.fulfillmentOrderId,
        attemptId: attempt?.id ?? null,
        allocationId: allocation?.id ?? null,
        sourceId: allocation?.sourceId ?? null,
        clientReference: attempt?.clientReference ?? null,
        provider: attempt?.provider ?? null,
        providerReference,
        errorCode,
        stopReason: plan.stopReason,
        deliveredAmount: plan.deliveredAmount,
        remainingAmount: workflow.remainingAmount - plan.deliveredAmount,
      };
      for (const transition of plan.transitions) {
        const applied = await writeOrderTransition(tx, {
          orderId: workflow.orderId,
          from: transition.from,
          to: transition.to,
          actorType: 'SYSTEM',
          reason: transition.reason,
          metadata,
          requestId: trace.requestId ?? undefined,
          outboxEventType: transition.event,
        });
        if (!applied) {
          throw new WorkflowConflictError(
            `Order ${workflow.orderId} left ${transition.from} concurrently`,
          );
        }
      }
    });
  }

  /**
   * Inventory effects of one step, in the step's transaction: delivered Robux are consumed from the
   * allocation, a source that did not deliver gives its reservation back (CURRENT), and a finished
   * workflow releases whatever is still held (ALL). Unknown or pending outcomes keep it.
   */
  private async settleInventory(
    tx: Tx,
    input: Pick<ApplyPlan, 'workflow' | 'allocation' | 'resolution' | 'plan' | 'trace'>,
  ): Promise<void> {
    const { workflow, allocation, resolution, plan, trace } = input;
    if (allocation && plan.deliveredAmount > 0) {
      await consumeAllocation(tx, allocation.id, plan.deliveredAmount, trace.requestId);
    }
    const toRelease =
      plan.releaseAllocations === 'ALL'
        ? [
            ...new Set([
              ...workflow.openAllocations.map((a) => a.id),
              ...(allocation ? [allocation.id] : []),
            ]),
          ]
        : plan.releaseAllocations === 'CURRENT' && allocation
          ? [allocation.id]
          : [];
    const reason =
      resolution.kind === 'DELIVERED'
        ? 'FULFILLED'
        : (plan.stopReason ?? resolution.error ?? 'RETRY');
    for (const id of toRelease) {
      await releaseAllocation(tx, id, trace.requestId, `Fulfillment ${reason}`);
    }
    if (allocation) {
      if (resolution.kind === 'DELIVERED') {
        await recordProviderOutcome(tx, allocation.sourceId, 'SUCCESS', trace.requestId);
      } else if (resolution.error && PROVIDER_FAILURES.has(resolution.error)) {
        await recordProviderOutcome(tx, allocation.sourceId, 'PROVIDER_FAILURE', trace.requestId);
      }
    }
  }

  async release(fulfillmentOrderId: string, leaseToken: string): Promise<void> {
    await this.prisma.fulfillmentOrder.updateMany({
      where: { id: fulfillmentOrderId, leaseToken },
      data: { leaseToken: null, leaseExpiresAt: null },
    });
  }

  /** Writes only while this run still holds the lease; otherwise the whole transaction is void. */
  private async holdLease(
    tx: Tx,
    fulfillmentOrderId: string,
    leaseToken: string,
    data: Prisma.FulfillmentOrderUpdateManyMutationInput,
  ): Promise<void> {
    const { count } = await tx.fulfillmentOrder.updateMany({
      where: { id: fulfillmentOrderId, leaseToken },
      data: { ...data, updatedAt: new Date() },
    });
    if (count === 0) {
      throw new WorkflowConflictError(`Lease on ${fulfillmentOrderId} is no longer held`);
    }
  }

  private async load(orderId: string, leaseToken: string): Promise<FulfillmentWorkflow> {
    const [order, fulfillmentOrder, retriesUsed] = await Promise.all([
      this.prisma.order.findUniqueOrThrow({
        where: { id: orderId },
        select: {
          status: true,
          fulfillmentMethod: true,
          productLine: true,
          fulfillmentType: true,
          recipientType: true,
          recipientUsername: true,
          recipientRobloxUserId: true,
        },
      }),
      this.prisma.fulfillmentOrder.findUniqueOrThrow({
        where: { orderId },
        select: { id: true, requestedAmount: true, fulfilledAmount: true, remainingAmount: true },
      }),
      this.prisma.orderStatusHistory.count({ where: { orderId, toStatus: 'RETRYING' } }),
    ]);
    const [latest, references, openAllocations] = await Promise.all([
      this.prisma.fulfillmentAttempt.findFirst({
        where: { fulfillmentOrderId: fulfillmentOrder.id },
        orderBy: { attemptNumber: 'desc' },
        select: ATTEMPT_SELECT,
      }),
      this.prisma.fulfillmentAttempt.findMany({
        where: { fulfillmentOrderId: fulfillmentOrder.id },
        distinct: ['clientReference'],
        select: { clientReference: true },
      }),
      this.prisma.fulfillmentAllocation.findMany({
        where: { fulfillmentOrderId: fulfillmentOrder.id, status: 'RESERVED' },
        orderBy: [{ reservedAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          sourceId: true,
          amount: true,
          consumedAmount: true,
          source: { select: { provider: true } },
        },
      }),
    ]);
    return {
      orderId,
      orderStatus: order.status,
      method: order.fulfillmentMethod,
      productLine: order.productLine,
      fulfillmentType: order.fulfillmentType,
      recipient:
        order.recipientType && order.recipientUsername
          ? {
              type: order.recipientType,
              identifier: order.recipientUsername,
              externalUserId: order.recipientRobloxUserId?.toString() ?? null,
            }
          : null,
      fulfillmentOrderId: fulfillmentOrder.id,
      requestedAmount: fulfillmentOrder.requestedAmount,
      fulfilledAmount: fulfillmentOrder.fulfilledAmount,
      remainingAmount: fulfillmentOrder.remainingAmount,
      retriesUsed,
      lastAttemptNumber: latest?.attemptNumber ?? 0,
      referencesUsed: references.length,
      latestAttempt: latest ? snapshotOf(latest) : null,
      openAllocations: openAllocations.map((a) => ({
        id: a.id,
        sourceId: a.sourceId,
        provider: a.source.provider,
        amount: a.amount,
        consumedAmount: a.consumedAmount,
      })),
      leaseToken,
    };
  }
}

function snapshotOf(attempt: {
  id: string;
  attemptNumber: number;
  provider: string;
  clientReference: string;
  requestedAmount: number;
  status: FulfillmentAttemptStatus;
  externalReference: string | null;
  allocationId: string | null;
}): AttemptSnapshot {
  return {
    id: attempt.id,
    attemptNumber: attempt.attemptNumber,
    provider: attempt.provider,
    clientReference: attempt.clientReference,
    requestedAmount: attempt.requestedAmount,
    status: attempt.status,
    providerReference: attempt.externalReference,
    allocationId: attempt.allocationId,
  };
}
