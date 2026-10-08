import type { PrismaClient } from '../../src/generated/prisma/client';
import { PrismaOrderStatusTransitionRepository } from '../../src/modules/orders/infrastructure/prisma-order-status-transition.repository';
import { createOrder, createProductWithPrice } from './support/fixtures';
import { asPrismaService, createTestPrisma } from './support/test-database';

describe('order status history', () => {
  let prisma: PrismaClient;
  let transitions: PrismaOrderStatusTransitionRepository;

  beforeAll(() => {
    prisma = createTestPrisma();
    transitions = new PrismaOrderStatusTransitionRepository(asPrismaService(prisma));
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function newOrder() {
    const { product, price } = await createProductWithPrice(prisma);
    return createOrder(prisma, { product, price });
  }

  it('records every transition so the full path can be reconstructed', async () => {
    const order = await newOrder();
    const path = [
      'PAYMENT_PENDING',
      'PAID',
      'QUEUED',
      'PROCESSING',
      'FULFILLMENT_PENDING',
      'FULFILLED',
    ] as const;
    let from: (typeof path)[number] | 'CREATED' = 'CREATED';
    for (const to of path) {
      const result = await transitions.apply({
        orderId: order.id,
        from,
        to,
        actorType: to === 'PAID' ? 'PAYMENT_GATEWAY' : 'SYSTEM',
        reason: `to ${to}`,
        requestId: 'req-history-test',
      });
      expect(result).toEqual({ applied: true });
      from = to;
    }

    const history = await prisma.orderStatusHistory.findMany({
      where: { orderId: order.id },
      orderBy: { id: 'asc' },
    });
    expect(history.map((h) => [h.fromStatus, h.toStatus])).toEqual([
      [null, 'CREATED'],
      ['CREATED', 'PAYMENT_PENDING'],
      ['PAYMENT_PENDING', 'PAID'],
      ['PAID', 'QUEUED'],
      ['QUEUED', 'PROCESSING'],
      ['PROCESSING', 'FULFILLMENT_PENDING'],
      ['FULFILLMENT_PENDING', 'FULFILLED'],
    ]);
    expect(history[2]).toMatchObject({
      actorType: 'PAYMENT_GATEWAY',
      reason: 'to PAID',
      requestId: 'req-history-test',
    });
    const stored = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored.status).toBe('FULFILLED');
  });

  it('does not apply or record a transition from a stale status', async () => {
    const order = await newOrder();
    const result = await transitions.apply({
      orderId: order.id,
      from: 'PAID',
      to: 'QUEUED',
      actorType: 'SYSTEM',
    });
    expect(result).toEqual({ applied: false, reason: 'STATUS_CHANGED_CONCURRENTLY' });
    expect(await prisma.orderStatusHistory.count({ where: { orderId: order.id } })).toBe(1);
  });

  it('lets exactly one of several concurrent writers win the same transition', async () => {
    const order = await newOrder();
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        transitions.apply({
          orderId: order.id,
          from: 'CREATED',
          to: 'PAYMENT_PENDING',
          actorType: 'SYSTEM',
        }),
      ),
    );
    expect(results.filter((r) => r.applied)).toHaveLength(1);
    const history = await prisma.orderStatusHistory.findMany({
      where: { orderId: order.id, toStatus: 'PAYMENT_PENDING' },
    });
    expect(history).toHaveLength(1);
  });

  it('records fulfillment attempt transitions in their own history', async () => {
    const order = await newOrder();
    const source = await prisma.fulfillmentSource.create({
      data: {
        provider: 'mock',
        name: `src-${order.id}`,
        status: 'ACTIVE',
        health: 'HEALTHY',
        availableBalance: 0n,
        reservedBalance: 500n,
        currency: 'IDR',
      },
    });
    const fulfillmentOrder = await prisma.fulfillmentOrder.create({
      data: { orderId: order.id, method: 'INSTANT', requestedAmount: 500, remainingAmount: 500 },
    });
    const allocation = await prisma.fulfillmentAllocation.create({
      data: {
        fulfillmentOrderId: fulfillmentOrder.id,
        sourceId: source.id,
        amount: 500,
        currency: 'IDR',
        unitCostSnapshot: '95',
      },
    });
    const attempt = await prisma.fulfillmentAttempt.create({
      data: {
        fulfillmentOrderId: fulfillmentOrder.id,
        allocationId: allocation.id,
        attemptNumber: 1,
        provider: 'mock',
        clientReference: `FULFILLMENT-${order.id}-1`,
        requestedAmount: 500,
      },
    });
    for (const [from, to] of [
      [null, 'PENDING'],
      ['PENDING', 'EXECUTING'],
      ['EXECUTING', 'UNKNOWN'],
      ['UNKNOWN', 'SUCCEEDED'],
    ] as const) {
      await prisma.fulfillmentAttemptStatusHistory.create({
        data: { attemptId: attempt.id, fromStatus: from, toStatus: to, actorType: 'SYSTEM' },
      });
    }
    const rows = await prisma.fulfillmentAttemptStatusHistory.findMany({
      where: { attemptId: attempt.id },
      orderBy: { id: 'asc' },
    });
    expect(rows.map((r) => r.toStatus)).toEqual(['PENDING', 'EXECUTING', 'UNKNOWN', 'SUCCEEDED']);
  });
});
