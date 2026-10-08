import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { generateGuestTrackingToken } from '../../src/modules/orders/domain/guest-tracking-token';
import { writeOrderTransition } from '../../src/modules/orders/infrastructure/order-transition.writer';
import { createOrder, createProductWithPrice, createSource } from './support/fixtures';
import { createTestPrisma } from './support/test-database';

describe('transactions and concurrency', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrisma();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('rolls back the whole order when any statement in the transaction fails', async () => {
    const { product, price } = await createProductWithPrice(prisma);
    const idempotencyKey = randomUUID();

    await expect(
      prisma.$transaction(async (tx) => {
        const order = await tx.order.create({
          data: {
            orderNumber: `RBX-20991231-${String(Math.floor(Math.random() * 90000) + 10000)}`,
            trackingTokenHash: generateGuestTrackingToken().hash,
            idempotencyKey,
            contactEmail: 'rollback@example.test',
            fulfillmentMethod: 'INSTANT',
            currency: 'IDR',
            subtotal: '69000',
            total: '69000',
            recipientRobloxUserId: 42n,
            recipientUsername: 'RollbackPlayer',
          },
        });
        await tx.orderStatusHistory.create({
          data: { orderId: order.id, toStatus: 'CREATED', actorType: 'SYSTEM' },
        });
        // Violates order_items_line_arithmetic, so the order and its history must disappear too.
        await tx.orderItem.create({
          data: {
            orderId: order.id,
            productId: product.id,
            productPriceId: price.id,
            productNameSnapshot: product.name,
            robuxAmount: 500,
            quantity: 2,
            currency: 'IDR',
            unitPriceSnapshot: '69000',
            unitCostSnapshot: '50000',
            lineSubtotal: '69000',
          },
        });
      }),
    ).rejects.toThrow();

    expect(await prisma.order.count({ where: { idempotencyKey } })).toBe(0);
    expect(await prisma.orderStatusHistory.count({ where: { order: { idempotencyKey } } })).toBe(0);
  });

  describe('order transition inside a caller transaction', () => {
    async function pendingOrder() {
      const { product, price } = await createProductWithPrice(prisma);
      return createOrder(prisma, { product, price, status: 'PAYMENT_PENDING' });
    }

    const toPaid = (orderId: string) => ({
      orderId,
      from: 'PAYMENT_PENDING' as const,
      to: 'PAID' as const,
      actorType: 'PAYMENT_GATEWAY' as const,
      reason: 'test',
      outboxEventType: 'PAYMENT_CONFIRMED',
    });

    async function effectsOf(orderId: string) {
      const [order, history, outbox] = await Promise.all([
        prisma.order.findUniqueOrThrow({ where: { id: orderId } }),
        prisma.orderStatusHistory.count({ where: { orderId, toStatus: 'PAID' } }),
        prisma.outboxEvent.count({ where: { aggregateId: orderId } }),
      ]);
      return { status: order.status, paidAt: order.paidAt, history, outbox };
    }

    it('leaves nothing behind when the caller transaction rolls back', async () => {
      const order = await pendingOrder();
      await expect(
        prisma.$transaction(async (tx) => {
          expect(await writeOrderTransition(tx, toPaid(order.id))).toBe(true);
          // A later statement of the same unit of work fails (e.g. the payment update).
          throw new Error('caller failed after the transition');
        }),
      ).rejects.toThrow('caller failed after the transition');

      expect(await effectsOf(order.id)).toEqual({
        status: 'PAYMENT_PENDING',
        paidAt: null,
        history: 0,
        outbox: 0,
      });
    });

    it('commits status, history and outbox together with the caller writes', async () => {
      const order = await pendingOrder();
      await prisma.$transaction(async (tx) => {
        await writeOrderTransition(tx, toPaid(order.id));
        await tx.outboxEvent.create({
          data: {
            aggregateType: 'order',
            aggregateId: order.id,
            eventType: 'CALLER_WRITE',
            payload: {},
          },
        });
      });
      const effects = await effectsOf(order.id);
      expect(effects).toMatchObject({ status: 'PAID', history: 1, outbox: 2 });
      expect(effects.paidAt).not.toBeNull();
    });
  });

  it('cannot reserve more than the available balance under concurrent orders (Scenario G)', async () => {
    const source = await createSource(prisma, 1_000n);

    // The reservation primitive from DATABASE.md §8, raced by two orders of 700.
    const reserve = (amount: number) =>
      prisma.$transaction(async (tx) => {
        const updated = await tx.$executeRaw`
          UPDATE fulfillment_sources
             SET available_balance = available_balance - ${amount},
                 reserved_balance  = reserved_balance  + ${amount}
           WHERE id = ${source.id}::uuid AND status = 'ACTIVE' AND available_balance >= ${amount}`;
        return updated === 1;
      });

    const results = await Promise.all([reserve(700), reserve(700)]);
    expect(results.filter(Boolean)).toHaveLength(1);

    const stored = await prisma.fulfillmentSource.findUniqueOrThrow({ where: { id: source.id } });
    expect(stored.availableBalance).toBe(300n);
    expect(stored.reservedBalance).toBe(700n);
  });

  it('settles an allocation at most once when consumed concurrently', async () => {
    const { product, price } = await createProductWithPrice(prisma);
    const source = await createSource(prisma, 0n);
    await prisma.fulfillmentSource.update({
      where: { id: source.id },
      data: { reservedBalance: 500n },
    });
    const order = await prisma.order.create({
      data: {
        orderNumber: `RBX-20991230-${String(Math.floor(Math.random() * 90000) + 10000)}`,
        trackingTokenHash: generateGuestTrackingToken().hash,
        idempotencyKey: randomUUID(),
        contactEmail: 'settle@example.test',
        status: 'PROCESSING',
        fulfillmentMethod: 'INSTANT',
        currency: 'IDR',
        subtotal: price.sellingPrice,
        total: price.sellingPrice,
        recipientRobloxUserId: 7n,
        recipientUsername: 'SettlePlayer',
        items: {
          create: {
            productId: product.id,
            productPriceId: price.id,
            productNameSnapshot: product.name,
            robuxAmount: 500,
            quantity: 1,
            currency: 'IDR',
            unitPriceSnapshot: price.sellingPrice,
            unitCostSnapshot: price.costPrice,
            lineSubtotal: price.sellingPrice,
          },
        },
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

    const consume = () =>
      prisma.$transaction(async (tx) => {
        const settled = await tx.fulfillmentAllocation.updateMany({
          where: { id: allocation.id, status: 'RESERVED' },
          data: { status: 'CONSUMED', consumedAmount: 500, settledAt: new Date() },
        });
        if (settled.count === 0) {
          return false;
        }
        await tx.fulfillmentSource.update({
          where: { id: source.id },
          data: { reservedBalance: { decrement: 500n } },
        });
        return true;
      });

    const results = await Promise.all([consume(), consume(), consume()]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const stored = await prisma.fulfillmentSource.findUniqueOrThrow({ where: { id: source.id } });
    expect(stored.reservedBalance).toBe(0n);
  });
});
