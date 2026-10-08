import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { planFulfillment } from '../../src/modules/fulfillment/domain/fulfillment-plan';
import {
  type FulfillmentWorkflow,
  WorkflowConflictError,
} from '../../src/modules/fulfillment/domain/fulfillment-workflow.repository';
import { PrismaFulfillmentWorkflowRepository } from '../../src/modules/fulfillment/infrastructure/prisma-fulfillment-workflow.repository';
import { planRouting } from '../../src/modules/inventory/domain/routing';
import { createOrder, createProductWithPrice, createSource } from './support/fixtures';
import { asPrismaService, createTestPrisma, expectDatabaseError } from './support/test-database';

/** The workflow repository against PostgreSQL: lease, transactional apply, constraints. */
describe('fulfillment workflow persistence', () => {
  let prisma: PrismaClient;
  let repository: PrismaFulfillmentWorkflowRepository;
  const trace = { eventId: randomUUID(), requestId: 'req-workflow' };

  beforeAll(() => {
    prisma = createTestPrisma();
    repository = new PrismaFulfillmentWorkflowRepository(asPrismaService(prisma));
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function queuedOrder(robuxAmount = 500, quantity = 2) {
    const { product, price } = await createProductWithPrice(prisma, { robuxAmount });
    return createOrder(prisma, { product, price, quantity, status: 'QUEUED' });
  }

  const lease = (offsetMs = 60_000) => {
    const now = new Date();
    return { token: randomUUID(), now, expiresAt: new Date(now.getTime() + offsetMs) };
  };

  async function acquired(orderId: string): Promise<FulfillmentWorkflow> {
    const result = await repository.acquire(orderId, lease());
    if (result.kind !== 'ACQUIRED') {
      throw new Error(`expected ACQUIRED, got ${result.kind}`);
    }
    return result.workflow;
  }

  /** A private source holding `available`, with the workflow's remaining amount reserved on it. */
  async function reservedOnNewSource(workflow: FulfillmentWorkflow, available = 5_000n) {
    const source = await createSource(prisma, available);
    const decision = planRouting(
      [
        {
          id: source.id,
          name: source.name,
          provider: source.provider,
          status: source.status,
          health: source.health,
          available: source.availableBalance,
          priority: source.priority,
          costPerUnit: null,
          providerConfigured: true,
        },
      ],
      workflow.remainingAmount,
    );
    if (decision.kind !== 'PLANNED') {
      throw new Error('expected a plan');
    }
    const [allocation] = await repository.reserve(workflow, decision, trace);
    return { source, allocation: allocation! };
  }

  const sourceRow = (id: string) => prisma.fulfillmentSource.findUniqueOrThrow({ where: { id } });

  it('creates one fulfillment order from the item snapshots and grants the lease to one of ten', async () => {
    const order = await queuedOrder(500, 2);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => repository.acquire(order.id, lease())),
    );
    expect(results.filter((r) => r.kind === 'ACQUIRED')).toHaveLength(1);
    expect(results.filter((r) => r.kind === 'BUSY')).toHaveLength(9);
    const rows = await prisma.fulfillmentOrder.findMany({ where: { orderId: order.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      requestedAmount: 1000,
      remainingAmount: 1000,
      fulfilledAmount: 0,
    });
  });

  it('lets a new run take over an expired lease (crashed worker)', async () => {
    const order = await queuedOrder();
    expect((await repository.acquire(order.id, lease(-1))).kind).toBe('ACQUIRED');
    expect((await repository.acquire(order.id, lease())).kind).toBe('ACQUIRED');
    expect((await repository.acquire(order.id, lease())).kind).toBe('BUSY');
  });

  it('refuses orders that are not on the automatic fulfillment path', async () => {
    const { product, price } = await createProductWithPrice(prisma);
    const paid = await createOrder(prisma, { product, price, status: 'PAID' });
    expect(await repository.acquire(paid.id, lease())).toMatchObject({
      kind: 'NOT_ELIGIBLE',
      orderStatus: 'PAID',
    });
    expect(await prisma.fulfillmentOrder.findUnique({ where: { orderId: paid.id } })).toBeNull();
    expect(await repository.acquire(randomUUID(), lease())).toEqual({ kind: 'ORDER_NOT_FOUND' });
  });

  it('writes nothing of a plan when any part fails: no success, no history, no outbox, lease kept', async () => {
    const order = await queuedOrder();
    const workflow = await acquired(order.id);
    expect(await repository.start(workflow, trace)).toBe(true);
    const { source, allocation } = await reservedOnNewSource(workflow);
    const processing = {
      ...(await repository.reload(workflow)),
      orderStatus: 'PROCESSING' as const,
    };
    const attempt = await repository.openAttempt({
      fulfillmentOrderId: workflow.fulfillmentOrderId,
      leaseToken: workflow.leaseToken,
      attemptNumber: 1,
      provider: 'mock',
      allocationId: allocation.id,
      clientReference: `FULFILLMENT-${order.id}-1`,
      requestedAmount: 1000,
      trace,
    });
    const resolution = {
      kind: 'DELIVERED',
      fulfilledAmount: 1000,
      providerReference: 'MOCK-X',
    } as const;
    const plan = planFulfillment({
      orderStatus: 'PROCESSING',
      fulfilledAmount: 0,
      remainingAmount: 1000,
      attemptRequestedAmount: 1000,
      resolution,
      retriesUsed: 0,
      maxAttempts: 5,
      finalRun: false,
    });
    // The provider answered SUCCEEDED; the order moves concurrently before the commit.
    await prisma.order.update({ where: { id: order.id }, data: { status: 'REFUND_PENDING' } });
    await expect(
      repository.apply({
        workflow: processing,
        attempt,
        allocation,
        resolution,
        plan,
        trace,
        now: new Date(),
      }),
    ).rejects.toThrow(WorkflowConflictError);
    // The reservation made before the step is untouched: nothing consumed, nothing released.
    expect(await sourceRow(source.id)).toMatchObject({
      availableBalance: 4_000n,
      reservedBalance: 1_000n,
    });
    expect(
      await prisma.fulfillmentAllocation.findUniqueOrThrow({ where: { id: allocation.id } }),
    ).toMatchObject({ status: 'RESERVED', consumedAmount: 0, releasedAmount: 0 });

    const [fo, storedAttempt, history, events] = await Promise.all([
      prisma.fulfillmentOrder.findUniqueOrThrow({ where: { orderId: order.id } }),
      prisma.fulfillmentAttempt.findUniqueOrThrow({ where: { id: attempt.id } }),
      prisma.orderStatusHistory.findMany({ where: { orderId: order.id } }),
      prisma.outboxEvent.findMany({ where: { aggregateId: order.id } }),
    ]);
    expect(fo).toMatchObject({
      fulfilledAmount: 0,
      remainingAmount: 1000,
      leaseToken: workflow.leaseToken,
    });
    expect(fo.status).not.toBe('FULFILLED');
    expect(storedAttempt).toMatchObject({
      status: 'EXECUTING',
      fulfilledAmount: 0,
      externalReference: null,
    });
    expect(history.map((h) => h.toStatus)).not.toContain('FULFILLED');
    expect(events.map((e) => e.eventType)).not.toContain('FULFILLMENT_COMPLETED');
  });

  it('commits attempt, amounts, transitions, history and outbox together and releases the lease', async () => {
    const order = await queuedOrder();
    const workflow = await acquired(order.id);
    await repository.start(workflow, trace);
    const { source, allocation } = await reservedOnNewSource(workflow);
    const reserved = await repository.reload(workflow);
    const attempt = await repository.openAttempt({
      fulfillmentOrderId: workflow.fulfillmentOrderId,
      leaseToken: workflow.leaseToken,
      attemptNumber: 1,
      provider: 'mock',
      allocationId: allocation.id,
      clientReference: `FULFILLMENT-${order.id}-1`,
      requestedAmount: 1000,
      trace,
    });
    const resolution = {
      kind: 'DELIVERED',
      fulfilledAmount: 400,
      providerReference: 'MOCK-P',
    } as const;
    const plan = planFulfillment({
      orderStatus: 'PROCESSING',
      fulfilledAmount: 0,
      remainingAmount: 1000,
      attemptRequestedAmount: 1000,
      resolution,
      retriesUsed: 0,
      maxAttempts: 5,
      finalRun: false,
    });
    await repository.apply({
      workflow: { ...reserved, orderStatus: 'PROCESSING' },
      attempt,
      allocation,
      resolution,
      plan,
      trace,
      now: new Date(),
    });
    const [ord, fo, stored, events] = await Promise.all([
      prisma.order.findUniqueOrThrow({ where: { id: order.id } }),
      prisma.fulfillmentOrder.findUniqueOrThrow({ where: { orderId: order.id } }),
      prisma.fulfillmentAttempt.findUniqueOrThrow({ where: { id: attempt.id } }),
      prisma.outboxEvent.findMany({ where: { aggregateId: order.id } }),
    ]);
    expect(ord.status).toBe('RETRYING');
    expect(fo).toMatchObject({ fulfilledAmount: 400, remainingAmount: 600, leaseToken: null });
    expect(stored).toMatchObject({
      status: 'PARTIAL',
      fulfilledAmount: 400,
      externalReference: 'MOCK-P',
    });
    expect(events.map((e) => e.eventType).sort()).toEqual(
      ['FULFILLMENT_PARTIAL', 'FULFILLMENT_RETRYING', 'FULFILLMENT_STARTED'].sort(),
    );
    expect(events.every((e) => e.publishedAt === null)).toBe(true);
    // Delivered Robux left the source; the remainder stays reserved for the same allocation.
    expect(await sourceRow(source.id)).toMatchObject({
      availableBalance: 4_000n,
      reservedBalance: 600n,
    });
    expect(
      await prisma.fulfillmentAllocation.findUniqueOrThrow({ where: { id: allocation.id } }),
    ).toMatchObject({ status: 'RESERVED', consumedAmount: 400, releasedAmount: 0 });
    const ledger = await prisma.sourceBalanceLog.findMany({
      where: { allocationId: allocation.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(ledger.map((l) => [l.reason, l.deltaAvailable, l.deltaReserved])).toEqual([
      ['RESERVE', -1000n, 1000n],
      ['CONSUME', 0n, -400n],
    ]);

    // The next run sees the remainder and a new request.
    const next = await acquired(order.id);
    expect(next).toMatchObject({
      orderStatus: 'RETRYING',
      remainingAmount: 600,
      retriesUsed: 1,
      lastAttemptNumber: 1,
      referencesUsed: 1,
      openAllocations: [{ id: allocation.id, amount: 1000, consumedAmount: 400 }],
    });
  });

  it('refuses writes from a run that lost its lease', async () => {
    const order = await queuedOrder();
    const stale = await acquired(order.id);
    await prisma.fulfillmentOrder.update({
      where: { orderId: order.id },
      data: { leaseToken: randomUUID(), leaseExpiresAt: new Date(Date.now() + 60_000) },
    });
    await expect(repository.start(stale, trace)).rejects.toThrow(WorkflowConflictError);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      'QUEUED',
    );
  });

  it('enforces one live attempt per order and one delivery per client reference', async () => {
    const order = await queuedOrder();
    const workflow = await acquired(order.id);
    const { allocation } = await reservedOnNewSource(workflow);
    const base = {
      fulfillmentOrderId: workflow.fulfillmentOrderId,
      provider: 'mock',
      allocationId: allocation.id,
      clientReference: `FULFILLMENT-${order.id}-1`,
      requestedAmount: 1000,
    };
    await prisma.fulfillmentAttempt.create({
      data: { ...base, attemptNumber: 1, status: 'EXECUTING' },
    });
    await expectDatabaseError(
      prisma.fulfillmentAttempt.create({ data: { ...base, attemptNumber: 2, status: 'UNKNOWN' } }),
      { constraint: 'fulfillment_attempts_one_live_per_order' },
    );
    await expect(
      repository.openAttempt({ ...base, leaseToken: workflow.leaseToken, attemptNumber: 2, trace }),
    ).rejects.toThrow(WorkflowConflictError);

    await prisma.fulfillmentAttempt.updateMany({
      where: { fulfillmentOrderId: workflow.fulfillmentOrderId },
      data: { status: 'SUCCEEDED', fulfilledAmount: 1000 },
    });
    // Retries of an undelivered request share the reference; a second delivery under it cannot exist.
    await prisma.fulfillmentAttempt.create({
      data: { ...base, attemptNumber: 2, status: 'FAILED_RETRYABLE' },
    });
    await expectDatabaseError(
      prisma.fulfillmentAttempt.create({
        data: { ...base, attemptNumber: 3, status: 'SUCCEEDED', fulfilledAmount: 1000 },
      }),
      { constraint: 'fulfillment_attempts_one_delivery_per_reference' },
    );
  });

  it('keeps the lease columns consistent', async () => {
    const order = await queuedOrder();
    await acquired(order.id);
    await expectDatabaseError(
      prisma.fulfillmentOrder.update({ where: { orderId: order.id }, data: { leaseToken: null } }),
      { constraint: 'fulfillment_orders_lease_complete' },
    );
  });

  it('reserves at most one plan per workflow: a second reservation while one is open is refused', async () => {
    const order = await queuedOrder();
    const workflow = await acquired(order.id);
    const { source } = await reservedOnNewSource(workflow);
    await expect(reservedOnNewSource(workflow)).rejects.toThrow(WorkflowConflictError);
    expect(
      await prisma.fulfillmentAllocation.count({
        where: { fulfillmentOrderId: workflow.fulfillmentOrderId },
      }),
    ).toBe(1);
    expect(await sourceRow(source.id)).toMatchObject({ reservedBalance: 1_000n });
  });
});
