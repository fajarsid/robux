import type { INestApplicationContext } from '@nestjs/common';
import { z } from 'zod';
import { BullMqJobScheduleRegistrar } from '../../../src/common/queue/bullmq-job-schedule.registrar';
import { BullMqQueueRegistry } from '../../../src/common/queue/bullmq-queue.registry';
import { defineJob } from '../../../src/common/queue/job-definition';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import { PAYMENT_EXPIRY_SWEEP_JOB } from '../../../src/processes/jobs/payment-expiry-sweep.job';
import { SchedulerModule } from '../../../src/processes/scheduler/scheduler.module';
import { SchedulerRuntime } from '../../../src/processes/scheduler/scheduler.runtime';
import { WorkerModule } from '../../../src/processes/worker/worker.module';
import { createOrder, createProductWithPrice } from '../support/fixtures';
import { createTestPrisma } from '../support/test-database';
import { startProcessModule, testProcessConfig, waitFor } from '../support/test-queue';
import { ExpireUnpaidOrdersService } from '../../../src/modules/orders/application/expire-unpaid-orders.service';

const OTHER_JOB = defineJob({ queue: 'payment', name: 'test.retired', payload: z.object({}) });

describe('job scheduler registration', () => {
  const registries: BullMqQueueRegistry[] = [];
  afterEach(async () => {
    await Promise.all(registries.splice(0).map((r) => r.onModuleDestroy()));
  });

  function registrar(config = testProcessConfig('scheduler')) {
    const registry = new BullMqQueueRegistry(config);
    registries.push(registry);
    return { registry, registrar: new BullMqJobScheduleRegistrar(registry), config };
  }

  it('is idempotent across restarts and concurrent schedulers', async () => {
    const first = registrar();
    const second = registrar(first.config);
    const schedule = { job: PAYMENT_EXPIRY_SWEEP_JOB, payload: {}, everyMs: 60_000 };

    await first.registrar.register([schedule]);
    await Promise.all([
      first.registrar.register([schedule]),
      second.registrar.register([schedule]),
    ]);

    const schedulers = await first.registry.get('payment').getJobSchedulers();
    expect(schedulers).toHaveLength(1);
    expect(schedulers[0]).toMatchObject({ key: 'payment.expiry-sweep', every: 60_000 });
  });

  it('removes schedules that are no longer declared', async () => {
    const { registry, registrar: r } = registrar();
    await r.register([
      { job: PAYMENT_EXPIRY_SWEEP_JOB, payload: {}, everyMs: 60_000 },
      { job: OTHER_JOB, payload: {}, everyMs: 60_000 },
    ]);
    await r.register([{ job: PAYMENT_EXPIRY_SWEEP_JOB, payload: {}, everyMs: 60_000 }]);

    const keys = (await registry.get('payment').getJobSchedulers()).map((s) => s.key);
    expect(keys).toEqual(['payment.expiry-sweep']);
  });
});

describe('payment expiry through scheduler and worker', () => {
  let prisma: PrismaClient;
  const apps: INestApplicationContext[] = [];

  beforeAll(() => {
    prisma = createTestPrisma();
  });
  afterEach(async () => {
    for (const app of apps.splice(0)) {
      await app.close();
    }
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('expires an overdue unpaid order exactly once with two schedulers, and a restart adds no schedule', async () => {
    const { product, price } = await createProductWithPrice(prisma);
    const order = await createOrder(prisma, { product, price, status: 'PAYMENT_PENDING' });
    await prisma.order.update({
      where: { id: order.id },
      // The deadline must follow creation (CHECK constraint), so both move into the past.
      data: {
        createdAt: new Date(Date.now() - 120_000),
        paymentExpiresAt: new Date(Date.now() - 60_000),
      },
    });

    const prefix = testProcessConfig('scheduler').queue.prefix;
    const env = { QUEUE_PREFIX: prefix };
    const scheduler = await startProcessModule(
      testProcessConfig('scheduler', env),
      SchedulerModule,
    );
    apps.push(scheduler);
    // A second scheduler instance (e.g. during a rolling restart) must not double the effects.
    apps.push(await startProcessModule(testProcessConfig('scheduler', env), SchedulerModule));
    apps.push(await startProcessModule(testProcessConfig('worker', env), WorkerModule));

    await waitFor(async () => {
      const current = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      return current.status === 'CANCELLED';
    });
    const expired = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { statusHistory: true },
    });
    expect(expired.cancelReason).toBe('PAYMENT_EXPIRED');
    expect(expired.statusHistory.filter((h) => h.toStatus === 'CANCELLED')).toEqual([
      expect.objectContaining({ fromStatus: 'PAYMENT_PENDING', actorType: 'SCHEDULER' }),
    ]);
    expect(
      await prisma.outboxEvent.count({
        where: { aggregateId: order.id, eventType: 'ORDER_EXPIRED' },
      }),
    ).toBe(1);
    // Another sweep (the next scheduled run) finds nothing left: one history row, one event.
    const worker = apps[apps.length - 1]!;
    expect(await worker.get(ExpireUnpaidOrdersService).expireDue()).toBe(0);
    expect(
      await prisma.orderStatusHistory.count({
        where: { orderId: order.id, toStatus: 'CANCELLED' },
      }),
    ).toBe(1);
    expect(
      await prisma.outboxEvent.count({
        where: { aggregateId: order.id, eventType: 'ORDER_EXPIRED' },
      }),
    ).toBe(1);
    await expect(scheduler.get(SchedulerRuntime).check()).resolves.toBeUndefined();

    await scheduler.close();
    apps.splice(apps.indexOf(scheduler), 1);
    const restarted = await startProcessModule(
      testProcessConfig('scheduler', env),
      SchedulerModule,
    );
    apps.push(restarted);
    await waitFor(async () =>
      restarted
        .get(SchedulerRuntime)
        .check()
        .then(
          () => true,
          () => false,
        ),
    );

    const registry = new BullMqQueueRegistry(testProcessConfig('scheduler', env));
    try {
      expect(await registry.get('payment').getJobSchedulers()).toHaveLength(1);
    } finally {
      await registry.onModuleDestroy();
    }
  });
});
