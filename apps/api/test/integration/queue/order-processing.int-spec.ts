import type { INestApplicationContext } from '@nestjs/common';
import { Worker } from 'bullmq';
import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../../../src/config/app-config';
import { bullMqConnection } from '../../../src/common/queue/bullmq-connection';
import { BullMqQueuePublisher } from '../../../src/common/queue/bullmq-queue.publisher';
import { BullMqQueueRegistry } from '../../../src/common/queue/bullmq-queue.registry';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import { QueuePaidOrderService } from '../../../src/modules/orders/application/queue-paid-order.service';
import { writeOrderTransition } from '../../../src/modules/orders/infrastructure/order-transition.writer';
import { PrismaOrderStatusTransitionRepository } from '../../../src/modules/orders/infrastructure/prisma-order-status-transition.repository';
import { OUTBOX_ROUTE_TABLE } from '../../../src/modules/outbox/application/outbox-route-table';
import { RelayOutboxEventsService } from '../../../src/modules/outbox/application/relay-outbox-events.service';
import { PrismaOutboxRelayRepository } from '../../../src/modules/outbox/infrastructure/prisma-outbox-relay.repository';
import { ORDER_PAYMENT_CONFIRMED_JOB } from '../../../src/processes/jobs/order-payment-confirmed.job';
import { WorkerModule } from '../../../src/processes/worker/worker.module';
import { DuitkuStub } from '../support/duitku-stub';
import { createOrder, createProductWithPrice, createSource } from '../support/fixtures';
import {
  createPaymentsTestApp,
  payAsGuest,
  placeGuestOrder,
  postCallback,
} from '../support/payments-app';
import { asPrismaService, createTestPrisma } from '../support/test-database';
import { startProcessModule, testProcessConfig, waitFor } from '../support/test-queue';

/**
 * PAYMENT_CONFIRMED → outbox relay → BullMQ (order-processing) → worker → PAID → QUEUED, with the
 * real WorkerModule. Each test uses its own queue prefix; assertions are per order, because the
 * shared database may hold events of other suites that a running worker also delivers.
 */
describe('order processing after payment (outbox → queue → worker)', () => {
  let prisma: PrismaClient;
  const apps: INestApplicationContext[] = [];
  const registries: BullMqQueueRegistry[] = [];

  beforeAll(() => {
    prisma = createTestPrisma();
  });
  afterEach(async () => {
    for (const app of apps.splice(0)) {
      await app.close();
    }
    await Promise.all(registries.splice(0).map((r) => r.onModuleDestroy()));
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function startWorker(config: AppConfig) {
    const app = await startProcessModule(config, WorkerModule);
    apps.push(app);
    return app;
  }

  function registryFor(config: AppConfig) {
    const registry = new BullMqQueueRegistry(config);
    registries.push(registry);
    return registry;
  }

  /** The payment path in miniature: order PAID and PAYMENT_CONFIRMED in one transaction. */
  async function confirmPayment(options: { rollback?: boolean; requestId?: string } = {}) {
    const { product, price } = await createProductWithPrice(prisma);
    const order = await createOrder(prisma, { product, price, status: 'PAYMENT_PENDING' });
    const write = prisma.$transaction(async (tx) => {
      await writeOrderTransition(tx, {
        orderId: order.id,
        from: 'PAYMENT_PENDING',
        to: 'PAID',
        actorType: 'PAYMENT_GATEWAY',
        reason: 'test payment',
        requestId: options.requestId,
        outboxEventType: 'PAYMENT_CONFIRMED',
      });
      if (options.rollback) {
        throw new Error('payment update failed after the order transition');
      }
    });
    if (options.rollback) {
      await expect(write).rejects.toThrow('payment update failed');
    } else {
      await write;
    }
    return order;
  }

  async function effectsOf(orderId: string) {
    const [order, queuedHistory, events] = await Promise.all([
      prisma.order.findUniqueOrThrow({ where: { id: orderId } }),
      prisma.orderStatusHistory.findMany({ where: { orderId, toStatus: 'QUEUED' } }),
      prisma.outboxEvent.findMany({
        where: { aggregateId: orderId },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return {
      status: order.status,
      queuedHistory,
      confirmed: events.filter((e) => e.eventType === 'PAYMENT_CONFIRMED'),
      fulfillmentRequested: events.filter((e) => e.eventType === 'FULFILLMENT_REQUESTED'),
    };
  }

  const queuedOnce = async (orderId: string) => {
    const effects = await effectsOf(orderId);
    return effects.status === 'QUEUED' ? effects : null;
  };

  /** Exactly one business effect: one transition, one fulfillment request. */
  function expectSingleEffect(effects: Awaited<ReturnType<typeof effectsOf>>) {
    expect(effects.status).toBe('QUEUED');
    expect(effects.queuedHistory).toHaveLength(1);
    expect(effects.fulfillmentRequested).toHaveLength(1);
    // The fulfillment request waits for its Phase 9 consumer: no route, never published.
    expect(effects.fulfillmentRequested[0]!.publishedAt).toBeNull();
  }

  it('relays a committed PAYMENT_CONFIRMED and moves the order to QUEUED exactly once', async () => {
    const requestId = `req-${randomUUID().slice(0, 8)}`;
    const order = await confirmPayment({ requestId });
    const config = testProcessConfig('worker');
    await startWorker(config);

    const effects = await waitFor(() => queuedOnce(order.id));
    expectSingleEffect(effects);
    expect(effects.confirmed[0]!.publishedAt).not.toBeNull();
    expect(effects.queuedHistory[0]).toMatchObject({
      fromStatus: 'PAID',
      actorType: 'SYSTEM',
      requestId,
      metadata: { outboxEventId: effects.confirmed[0]!.id },
    });

    // The job carries identifiers and the correlation id only.
    const job = await registryFor(config).get('order-processing').getJob(effects.confirmed[0]!.id);
    expect(job?.name).toBe('order.payment-confirmed');
    expect(job?.data).toEqual({
      payload: {
        eventId: effects.confirmed[0]!.id,
        eventType: 'PAYMENT_CONFIRMED',
        aggregateType: 'order',
        aggregateId: order.id,
      },
      correlationId: requestId,
    });
  });

  it('leaves no event and no job when the payment transaction rolls back', async () => {
    const order = await confirmPayment({ rollback: true });
    const config = testProcessConfig('worker');
    await startWorker(config);
    // Give the relay several polling cycles.
    await new Promise((resolve) => setTimeout(resolve, 2_500));

    const effects = await effectsOf(order.id);
    expect(effects.status).toBe('PAYMENT_PENDING');
    expect(effects.confirmed).toHaveLength(0);
    expect(effects.queuedHistory).toHaveLength(0);
    const jobs = await registryFor(config)
      .get('order-processing')
      .getJobs(['waiting', 'active', 'completed', 'failed', 'delayed']);
    expect(jobs.filter((job) => job.data.payload.aggregateId === order.id)).toHaveLength(0);
  });

  it('delivers an event committed while no worker was running (process died before the relay)', async () => {
    const order = await confirmPayment();
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect((await effectsOf(order.id)).confirmed[0]!.publishedAt).toBeNull();

    await startWorker(testProcessConfig('worker'));
    expectSingleEffect(await waitFor(() => queuedOnce(order.id)));
  });

  it('keeps the event while Redis is unreachable and delivers it once Redis is back', async () => {
    const order = await confirmPayment();
    const outbox = new PrismaOutboxRelayRepository(asPrismaService(prisma));
    const deadRedis = registryFor(testProcessConfig('worker', { REDIS_PORT: '1' }));
    const failing = new RelayOutboxEventsService(
      outbox,
      new BullMqQueuePublisher(deadRedis),
      OUTBOX_ROUTE_TABLE,
    );
    // Other suites may have left older PAYMENT_CONFIRMED rows; relay until ours has been tried.
    await waitFor(
      async () => {
        await failing.relayOnce();
        const event = (await effectsOf(order.id)).confirmed[0]!;
        return event.attempts > 0 ? event : null;
      },
      { timeoutMs: 30_000, intervalMs: 10 },
    ).then((event) => {
      expect(event.publishedAt).toBeNull();
      expect(event.lastError).toBeTruthy();
    });
    expect((await effectsOf(order.id)).status).toBe('PAID');

    await startWorker(testProcessConfig('worker'));
    expectSingleEffect(await waitFor(() => queuedOnce(order.id), { timeoutMs: 30_000 }));
  });

  it('applies duplicate and concurrent deliveries of the same event once', async () => {
    const order = await confirmPayment();
    const event = (await effectsOf(order.id)).confirmed[0]!;
    const config = testProcessConfig('worker');
    const publisher = new BullMqQueuePublisher(registryFor(config));
    const payload = {
      eventId: event.id,
      eventType: event.eventType,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
    };
    // Redelivery beyond BullMQ's job-id dedupe (record expired, operator re-run, re-emitted event).
    await Promise.all(
      Array.from({ length: 6 }, () =>
        publisher.publish(ORDER_PAYMENT_CONFIRMED_JOB, payload, { jobId: randomUUID() }),
      ),
    );
    await startWorker(config);
    await startWorker(config);

    await waitFor(() => queuedOnce(order.id));
    const queue = registryFor(config).get('order-processing');
    await waitFor(async () => {
      const counts = await queue.getJobCounts('waiting', 'active', 'delayed');
      return Object.values(counts).every((count) => count === 0);
    });
    expectSingleEffect(await effectsOf(order.id));
  });

  it('lets several workers relay and process many events without duplicate effects', async () => {
    const orders = await Promise.all(Array.from({ length: 8 }, () => confirmPayment()));
    const config = testProcessConfig('worker');
    await Promise.all([startWorker(config), startWorker(config), startWorker(config)]);

    for (const order of orders) {
      const delivered = await waitFor(
        async () => {
          const effects = await effectsOf(order.id);
          return effects.confirmed[0]?.publishedAt && effects.status === 'QUEUED' ? effects : null;
        },
        { timeoutMs: 30_000 },
      );
      expectSingleEffect(delivered);
    }
  });

  it('redelivers a job whose worker died after the business effect, without a second effect', async () => {
    const order = await confirmPayment();
    const event = (await effectsOf(order.id)).confirmed[0]!;
    const config = testProcessConfig('worker');
    const publisher = new BullMqQueuePublisher(registryFor(config));
    await publisher.publish(
      ORDER_PAYMENT_CONFIRMED_JOB,
      {
        eventId: event.id,
        eventType: event.eventType,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
      },
      { jobId: event.id },
    );

    // A worker that commits the effect, then dies before acknowledging the job.
    const queuePaidOrder = new QueuePaidOrderService(
      new PrismaOrderStatusTransitionRepository(asPrismaService(prisma)),
    );
    let effectDone!: () => void;
    const done = new Promise<void>((resolve) => (effectDone = resolve));
    const crashing = new Worker(
      'order-processing',
      async () => {
        await queuePaidOrder.queue(order.id, { outboxEventId: event.id });
        effectDone();
        await new Promise(() => undefined);
      },
      {
        connection: bullMqConnection(config, 'consumer'),
        prefix: config.queue.prefix,
        lockDuration: 2_000,
        stalledInterval: 1_000,
      },
    );
    await done;
    await crashing.close(true);

    // The real worker picks the stalled job up again; the second run must change nothing.
    await startWorker(config);
    const queue = registryFor(config).get('order-processing');
    await waitFor(async () => (await queue.getJob(event.id))?.finishedOn, { timeoutMs: 75_000 });
    const job = await queue.getJob(event.id);
    expect(await job?.isCompleted()).toBe(true);
    expectSingleEffect(await effectsOf(order.id));
  }, 90_000);

  it('takes a verified Duitku payment through to QUEUED once, even with concurrent callbacks', async () => {
    const stub = new DuitkuStub();
    const api = await createPaymentsTestApp(stub);
    try {
      await createSource(prisma, 1_000_000n);
      const placed = await placeGuestOrder(api, prisma);
      expect((await payAsGuest(placed.browser, placed.token)).status).toBe(201);
      const merchantOrderId = `${placed.order.orderNumber}-1`;
      stub.settle(merchantOrderId, '00');
      const form = stub.callbackForm(merchantOrderId);
      const responses = await Promise.all(Array.from({ length: 5 }, () => postCallback(api, form)));
      expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);

      await startWorker(testProcessConfig('worker'));
      const effects = await waitFor(() => queuedOnce(placed.order.id));
      expectSingleEffect(effects);
      expect(effects.confirmed).toHaveLength(1);
      const payment = await prisma.payment.findUniqueOrThrow({ where: { merchantOrderId } });
      expect(payment.status).toBe('PAID');
    } finally {
      await api.close();
    }
  });

  it('fails a job that does not match a committed event without retrying, and keeps it inspectable', async () => {
    const config = testProcessConfig('worker');
    const publisher = new BullMqQueuePublisher(registryFor(config));
    const forgedId = randomUUID();
    await publisher.publish(
      ORDER_PAYMENT_CONFIRMED_JOB,
      {
        eventId: forgedId,
        eventType: 'PAYMENT_CONFIRMED',
        aggregateType: 'order',
        aggregateId: randomUUID(),
      },
      { jobId: forgedId, correlationId: 'req-forged' },
    );
    await startWorker(config);

    const queue = registryFor(config).get('order-processing');
    const failed = await waitFor(async () => {
      const job = await queue.getJob(forgedId);
      return job && (await job.isFailed()) ? job : null;
    });
    expect(failed.attemptsMade).toBe(1);
    expect(failed.failedReason).toContain('does not match a committed PAYMENT_CONFIRMED event');
    expect(failed.name).toBe('order.payment-confirmed');
    expect(failed.queueName).toBe('order-processing');
    expect(failed.data.correlationId).toBe('req-forged');
  });
});
