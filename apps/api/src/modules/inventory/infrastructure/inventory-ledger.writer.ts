import type { Prisma } from '../../../generated/prisma/client';
import {
  InventoryEvent,
  SOURCE_AGGREGATE,
  UNAVAILABLE_AFTER_CONSECUTIVE_FAILURES,
} from '../domain/inventory-events';
import { ReservationConflictError } from '../domain/reservation-conflict.error';
import type { PlannedAllocation, RoutingDecisionRecord } from '../domain/routing';

type Tx = Prisma.TransactionClient;

/**
 * Inventory writes that run inside the caller's transaction (like the orders transition writer),
 * so a reservation, consumption or release commits together with the fulfillment step it belongs
 * to (DATABASE.md §8). Every balance change is one conditional UPDATE: the row lock it takes
 * serialises concurrent writers, and the WHERE clause, not an earlier read, decides whether the
 * inventory is there. CHECK constraints are the last line of defence against negative balances.
 */

export interface ReservedAllocation {
  id: string;
  sourceId: string;
  provider: string;
  amount: number;
  consumedAmount: number;
}

export async function reserveAllocations(
  tx: Tx,
  input: {
    fulfillmentOrderId: string;
    allocations: readonly PlannedAllocation[];
    record: RoutingDecisionRecord;
    requestId: string | null;
  },
): Promise<ReservedAllocation[]> {
  const reserved: ReservedAllocation[] = [];
  const [order] = await tx.$queryRaw<
    { order_id: string; product_id: string; product_line: string }[]
  >`
    SELECT fo.order_id::text AS order_id, oi.product_id::text AS product_id, o.product_line::text AS product_line
      FROM fulfillment_orders fo JOIN orders o ON o.id = fo.order_id
      JOIN order_items oi ON oi.order_id = o.id
     WHERE fo.id = ${input.fulfillmentOrderId}::uuid LIMIT 1`;
  // Ascending source id: two transactions never wait on each other's rows in opposite order.
  const ordered = [...input.allocations].sort((a, b) => (a.sourceId < b.sourceId ? -1 : 1));
  for (const planned of ordered) {
    const amount = BigInt(planned.amount);
    const [source] = await tx.$queryRaw<
      {
        provider: string;
        currency: string;
        cost_per_unit: Prisma.Decimal | null;
        available_balance: bigint;
        reserved_balance: bigint;
      }[]
    >`
      UPDATE fulfillment_sources
         SET available_balance = available_balance - ${amount},
             reserved_balance = reserved_balance + ${amount},
             updated_at = now()
       WHERE id = ${planned.sourceId}::uuid
         AND status = 'ACTIVE'
         AND health IN ('HEALTHY', 'DEGRADED')
         AND available_balance >= ${amount}
   RETURNING provider, currency::text AS currency, cost_per_unit, available_balance, reserved_balance`;
    if (!source) {
      throw new ReservationConflictError(planned.sourceId);
    }
    const allocation = await tx.fulfillmentAllocation.create({
      data: {
        fulfillmentOrderId: input.fulfillmentOrderId,
        sourceId: planned.sourceId,
        amount: planned.amount,
        currency: source.currency as 'IDR',
        // Snapshot: later cost changes on the source never alter this allocation's cost.
        unitCostSnapshot: source.cost_per_unit,
        routingStrategy: input.record.strategy,
        routingDecision: {
          ...input.record,
          selected: input.allocations,
        } as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    if (order?.product_line === 'TELEGRAM_ACCOUNT') {
      const items = await tx.$queryRaw<{ id: string }[]>`
        UPDATE digital_inventory_items
           SET status = 'RESERVED', allocation_id = ${allocation.id}::uuid, order_id = ${order.order_id}::uuid,
               reserved_at = now(), updated_at = now()
         WHERE id IN (
           SELECT id FROM digital_inventory_items
            WHERE product_id = ${order.product_id}::uuid AND source_id = ${planned.sourceId}::uuid
              AND status = 'AVAILABLE'
            ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT ${planned.amount}
         )
        RETURNING id::text AS id`;
      if (items.length !== planned.amount) throw new ReservationConflictError(planned.sourceId);
      await tx.auditLog.create({
        data: {
          action: 'INVENTORY_ITEM_RESERVED',
          result: 'SUCCESS',
          actorType: 'SYSTEM',
          resourceType: 'order',
          resourceId: order.order_id,
          after: { count: items.length, allocationId: allocation.id },
        },
      });
    }
    await tx.sourceBalanceLog.create({
      data: {
        sourceId: planned.sourceId,
        allocationId: allocation.id,
        reason: 'RESERVE',
        deltaAvailable: -amount,
        deltaReserved: amount,
        availableAfter: source.available_balance,
        reservedAfter: source.reserved_balance,
        requestId: input.requestId,
      },
    });
    await markLowBalanceIfCrossed(tx, planned.sourceId, input.requestId);
    reserved.push({
      id: allocation.id,
      sourceId: planned.sourceId,
      provider: source.provider,
      amount: planned.amount,
      consumedAmount: 0,
    });
  }
  return reserved;
}

/**
 * Robux delivered from an allocation leave the source: reserved -= n. The allocation becomes
 * CONSUMED once all of it is delivered; until then the rest stays reserved for the same request.
 */
export async function consumeAllocation(
  tx: Tx,
  allocationId: string,
  delivered: number,
  requestId: string | null,
): Promise<void> {
  const [accountOrder] = await tx.$queryRaw<{ order_id: string; product_line: string }[]>`
    SELECT fo.order_id::text AS order_id, o.product_line::text AS product_line
      FROM fulfillment_allocations a JOIN fulfillment_orders fo ON fo.id = a.fulfillment_order_id
      JOIN orders o ON o.id = fo.order_id WHERE a.id = ${allocationId}::uuid`;
  const [allocation] = await tx.$queryRaw<{ source_id: string }[]>`
    UPDATE fulfillment_allocations
       SET consumed_amount = consumed_amount + ${delivered},
           status = (CASE WHEN consumed_amount + ${delivered} = amount THEN 'CONSUMED' ELSE 'RESERVED' END)::allocation_status,
           settled_at = CASE WHEN consumed_amount + ${delivered} = amount THEN now() ELSE NULL END,
           updated_at = now()
     WHERE id = ${allocationId}::uuid
       AND status = 'RESERVED'
       AND consumed_amount + ${delivered} <= amount
 RETURNING source_id::text AS source_id`;
  if (!allocation) {
    throw new Error(`Allocation ${allocationId} cannot consume ${delivered}`);
  }
  if (accountOrder?.product_line === 'TELEGRAM_ACCOUNT') {
    const items = await tx.$queryRaw<{ id: string }[]>`
      UPDATE digital_inventory_items SET status = 'SOLD', sold_at = now(), updated_at = now()
       WHERE id IN (SELECT id FROM digital_inventory_items WHERE allocation_id = ${allocationId}::uuid
          AND status = 'RESERVED' ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT ${delivered})
       RETURNING id::text AS id`;
    if (items.length !== delivered)
      throw new Error('Reserved digital account inventory is inconsistent');
    await tx.auditLog.create({
      data: {
        action: 'INVENTORY_ITEM_SOLD',
        result: 'SUCCESS',
        actorType: 'SYSTEM',
        resourceType: 'order',
        resourceId: accountOrder.order_id,
        after: { count: items.length, allocationId },
      },
    });
  }
  const amount = BigInt(delivered);
  const [source] = await tx.$queryRaw<{ available_balance: bigint; reserved_balance: bigint }[]>`
    UPDATE fulfillment_sources
       SET reserved_balance = reserved_balance - ${amount}, updated_at = now()
     WHERE id = ${allocation.source_id}::uuid
 RETURNING available_balance, reserved_balance`;
  await tx.sourceBalanceLog.create({
    data: {
      sourceId: allocation.source_id,
      allocationId,
      reason: 'CONSUME',
      deltaAvailable: 0n,
      deltaReserved: -amount,
      availableAfter: source!.available_balance,
      reservedAfter: source!.reserved_balance,
      requestId,
    },
  });
}

/**
 * Returns the unconsumed part of an allocation to the source and settles it. Idempotent: an
 * allocation that is already settled changes nothing. A disabled source gets its inventory back
 * too; the kill switch only stops new allocations.
 */
export async function releaseAllocation(
  tx: Tx,
  allocationId: string,
  requestId: string | null,
  note: string,
): Promise<number> {
  const [accountOrder] = await tx.$queryRaw<{ order_id: string; product_line: string }[]>`
    SELECT fo.order_id::text AS order_id, o.product_line::text AS product_line
      FROM fulfillment_allocations a JOIN fulfillment_orders fo ON fo.id = a.fulfillment_order_id
      JOIN orders o ON o.id = fo.order_id WHERE a.id = ${allocationId}::uuid`;
  const [allocation] = await tx.$queryRaw<{ source_id: string; released: number }[]>`
    UPDATE fulfillment_allocations
       SET released_amount = amount - consumed_amount,
           status = (CASE WHEN consumed_amount = 0 THEN 'RELEASED' ELSE 'CONSUMED' END)::allocation_status,
           settled_at = now(),
           updated_at = now()
     WHERE id = ${allocationId}::uuid AND status = 'RESERVED'
 RETURNING source_id::text AS source_id, (amount - consumed_amount) AS released`;
  if (!allocation || allocation.released === 0) {
    return 0;
  }
  if (accountOrder?.product_line === 'TELEGRAM_ACCOUNT') {
    const items = await tx.$queryRaw<{ id: string }[]>`
      UPDATE digital_inventory_items SET status = 'AVAILABLE', allocation_id = NULL, order_id = NULL,
        reserved_at = NULL, updated_at = now()
       WHERE allocation_id = ${allocationId}::uuid AND status = 'RESERVED'
       RETURNING id::text AS id`;
    if (items.length !== allocation.released)
      throw new Error('Reserved digital account inventory is inconsistent');
    await tx.auditLog.create({
      data: {
        action: 'INVENTORY_ITEM_RELEASED',
        result: 'SUCCESS',
        actorType: 'SYSTEM',
        resourceType: 'order',
        resourceId: accountOrder.order_id,
        after: { count: items.length, allocationId },
      },
    });
  }
  const amount = BigInt(allocation.released);
  const [source] = await tx.$queryRaw<{ available_balance: bigint; reserved_balance: bigint }[]>`
    UPDATE fulfillment_sources
       SET available_balance = available_balance + ${amount},
           reserved_balance = reserved_balance - ${amount},
           updated_at = now()
     WHERE id = ${allocation.source_id}::uuid
 RETURNING available_balance, reserved_balance`;
  await tx.sourceBalanceLog.create({
    data: {
      sourceId: allocation.source_id,
      allocationId,
      reason: 'RELEASE',
      deltaAvailable: amount,
      deltaReserved: -amount,
      availableAfter: source!.available_balance,
      reservedAfter: source!.reserved_balance,
      note,
      requestId,
    },
  });
  await clearLowBalanceIfRecovered(tx, allocation.source_id);
  return allocation.released;
}

/**
 * Health from provider answers. A success makes the source HEALTHY again; a provider-side failure
 * makes it DEGRADED (still routable), and only several in a row take it out of routing. One error
 * never marks a source dead, and a recovered provider is found by the health check job.
 */
export async function recordProviderOutcome(
  tx: Tx,
  sourceId: string,
  outcome: 'SUCCESS' | 'PROVIDER_FAILURE',
  requestId: string | null,
): Promise<void> {
  if (outcome === 'SUCCESS') {
    await tx.$executeRaw`
      UPDATE fulfillment_sources
         SET consecutive_failures = 0, health = 'HEALTHY', updated_at = now()
       WHERE id = ${sourceId}::uuid AND (consecutive_failures <> 0 OR health <> 'HEALTHY')`;
    return;
  }
  const [source] = await tx.$queryRaw<{ became_unavailable: boolean }[]>`
    UPDATE fulfillment_sources s
       SET consecutive_failures = s.consecutive_failures + 1,
           health = (CASE WHEN s.consecutive_failures + 1 >= ${UNAVAILABLE_AFTER_CONSECUTIVE_FAILURES}
                          THEN 'UNAVAILABLE' ELSE 'DEGRADED' END)::source_health,
           updated_at = now()
      FROM (SELECT health FROM fulfillment_sources WHERE id = ${sourceId}::uuid FOR UPDATE) before
     WHERE s.id = ${sourceId}::uuid
 RETURNING (before.health <> 'UNAVAILABLE' AND s.health = 'UNAVAILABLE') AS became_unavailable`;
  if (source?.became_unavailable) {
    await writeSourceEvent(tx, sourceId, InventoryEvent.SOURCE_UNAVAILABLE, requestId, {
      consecutiveFailures: UNAVAILABLE_AFTER_CONSECUTIVE_FAILURES,
    });
  }
}

/**
 * Edge trigger: only the update that moves the source into the low state writes the event; while
 * it stays low, `low_balance_since` is set and nothing more is written.
 */
export async function markLowBalanceIfCrossed(
  tx: Tx,
  sourceId: string,
  requestId: string | null,
): Promise<void> {
  const [crossed] = await tx.$queryRaw<
    { available_balance: bigint; low_balance_threshold: bigint }[]
  >`
    UPDATE fulfillment_sources
       SET low_balance_since = now()
     WHERE id = ${sourceId}::uuid
       AND low_balance_since IS NULL
       AND low_balance_threshold > 0
       AND available_balance < low_balance_threshold
 RETURNING available_balance, low_balance_threshold`;
  if (crossed) {
    await writeSourceEvent(tx, sourceId, InventoryEvent.SOURCE_LOW_BALANCE, requestId, {
      availableBalance: crossed.available_balance.toString(),
      lowBalanceThreshold: crossed.low_balance_threshold.toString(),
    });
  }
}

/** Leaving the low state re-arms the alert for the next crossing. */
export async function clearLowBalanceIfRecovered(tx: Tx, sourceId: string): Promise<void> {
  await tx.$executeRaw`
    UPDATE fulfillment_sources
       SET low_balance_since = NULL
     WHERE id = ${sourceId}::uuid
       AND low_balance_since IS NOT NULL
       AND (low_balance_threshold = 0 OR available_balance >= low_balance_threshold)`;
}

async function writeSourceEvent(
  tx: Tx,
  sourceId: string,
  eventType: string,
  requestId: string | null,
  details: Record<string, string | number>,
): Promise<void> {
  await tx.outboxEvent.create({
    data: {
      aggregateType: SOURCE_AGGREGATE,
      aggregateId: sourceId,
      eventType,
      payload: { sourceId, ...details },
      requestId,
    },
  });
}
