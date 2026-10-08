import type { INestApplicationContext } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../../../src/config/app-config';
import { BullMqQueuePublisher } from '../../../src/common/queue/bullmq-queue.publisher';
import { BullMqQueueRegistry } from '../../../src/common/queue/bullmq-queue.registry';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import {
  FULFILLMENT_PROVIDER_REGISTRY,
  FulfillmentProviderRegistry,
} from '../../../src/modules/fulfillment/application/fulfillment-provider.registry';
import type {
  FulfillmentProvider,
  FulfillmentRecipient,
  FulfillmentRequest,
} from '../../../src/modules/fulfillment/domain/fulfillment-provider';
import { MockFulfillmentProvider } from '../../../src/modules/fulfillment/infrastructure/providers/mock/mock-fulfillment.provider';
import type { MockScenario } from '../../../src/modules/fulfillment/infrastructure/providers/mock/mock-scenario';
import { writeOrderTransition } from '../../../src/modules/orders/infrastructure/order-transition.writer';
import { FULFILLMENT_REQUESTED_JOB } from '../../../src/processes/jobs/fulfillment-requested.job';
import { SourceHealthCheckService } from '../../../src/modules/fulfillment/application/source-health-check.service';
import { WorkerModule } from '../../../src/processes/worker/worker.module';
import { createOrder, createProductWithPrice, createSource } from '../support/fixtures';
import { createTestPrisma } from '../support/test-database';
import { startProcessModuleWith, testProcessConfig, waitFor } from '../support/test-queue';

/** The mock behind the port, with every fulfill call recorded per order. */
class RecordingProvider implements FulfillmentProvider {
  readonly calls: FulfillmentRequest[] = [];

  constructor(
    readonly mock: MockFulfillmentProvider,
    readonly code: string,
  ) {}

  getBalance() {
    return this.mock.getBalance();
  }
  validateRecipient(recipient: FulfillmentRecipient) {
    return this.mock.validateRecipient(recipient);
  }
  fulfill(request: FulfillmentRequest) {
    this.calls.push(request);
    return this.mock.fulfill(request);
  }
  verify(lookup: Parameters<FulfillmentProvider['verify']>[0]) {
    return this.mock.verify(lookup);
  }

  callsFor(orderId: string) {
    return this.calls.filter((c) => c.clientReference.startsWith(`FULFILLMENT-${orderId}-`));
  }
}

/**
 * FULFILLMENT_REQUESTED → outbox relay → BullMQ (fulfillment) → worker → FulfillmentEngine →
 * registry → MockFulfillmentProvider, with the real WorkerModule and PostgreSQL. The shared
 * database holds orders of other suites that these workers also process, so every assertion is
 * per order and per client reference.
 */
describe('fulfillment engine (worker, mock provider)', () => {
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

  async function startWorkers(
    scenario: MockScenario,
    options: { workers?: number; config?: AppConfig } = {},
  ) {
    const config = options.config ?? testProcessConfig('worker', { FULFILLMENT_PROVIDER: 'mock' });
    const provider = new RecordingProvider(
      new MockFulfillmentProvider({
        scenario,
        balance: 1_000_000_000n,
        referencePrefix: `MOCK-${randomUUID().slice(0, 8)}`,
      }),
      // A provider code of its own: sources other suites left in the shared database (provider
      // `mock`) are not configured here, so routing only uses this test's source.
      `mock-${randomUUID().slice(0, 8)}`,
    );
    const source = await createSource(prisma, 1_000_000n, { provider: provider.code });
    // Stock of the Telegram lines on the same test provider (ADR-009: a source serves one line).
    const telegramSources = {
      premium: await createSource(prisma, 1_000_000n, {
        provider: provider.code,
        productLine: 'TELEGRAM_PREMIUM',
      }),
      stars: await createSource(prisma, 1_000_000n, {
        provider: provider.code,
        productLine: 'TELEGRAM_STARS',
      }),
      accounts: await createSource(prisma, 50n, {
        provider: provider.code,
        productLine: 'TELEGRAM_ACCOUNT',
      }),
    };
    const registry = new FulfillmentProviderRegistry([provider]);
    for (let i = 0; i < (options.workers ?? 1); i += 1) {
      apps.push(
        await startProcessModuleWith(config, WorkerModule, [
          { provide: FULFILLMENT_PROVIDER_REGISTRY, useValue: registry },
        ]),
      );
    }
    return { provider, mock: provider.mock, config, source, telegramSources };
  }

  const recoverSources = () => apps[0]!.get(SourceHealthCheckService).checkUnavailableSources();

  /** The payment path in miniature: order PAID and PAYMENT_CONFIRMED in one transaction. */
  async function paidOrder(
    robuxAmount = 500,
    requestId = `req-${randomUUID().slice(0, 8)}`,
    snapshot?: Parameters<typeof createOrder>[1]['snapshot'],
    accountSourceId?: string,
  ) {
    const { product, price } = await createProductWithPrice(prisma, {
      robuxAmount,
      productLine: snapshot?.productLine,
    });
    const order = await createOrder(prisma, {
      product,
      price,
      status: 'PAYMENT_PENDING',
      snapshot,
    });
    if (snapshot?.productLine === 'TELEGRAM_ACCOUNT' && accountSourceId) {
      await prisma.digitalInventoryItem.create({
        data: {
          productId: product.id,
          sourceId: accountSourceId,
          encryptedPayload: Buffer.alloc(40, 9),
          keyVersion: 1,
        },
      });
    }
    await prisma.$transaction((tx) =>
      writeOrderTransition(tx, {
        orderId: order.id,
        from: 'PAYMENT_PENDING',
        to: 'PAID',
        actorType: 'PAYMENT_GATEWAY',
        reason: 'test payment',
        requestId,
        outboxEventType: 'PAYMENT_CONFIRMED',
      }),
    );
    return { order, requestId };
  }

  async function stateOf(orderId: string) {
    // The order first: once its status is read, everything committed with it is visible below.
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    const [history, events, fulfillmentOrder] = await Promise.all([
      prisma.orderStatusHistory.findMany({ where: { orderId } }),
      prisma.outboxEvent.findMany({ where: { aggregateId: orderId } }),
      prisma.fulfillmentOrder.findUnique({
        where: { orderId },
        include: {
          attempts: { orderBy: { attemptNumber: 'asc' }, include: { statusHistory: true } },
        },
      }),
    ]);
    return {
      order,
      history,
      steps: history.filter((h) => h.fromStatus).map((h) => `${h.fromStatus}>${h.toStatus}`),
      events: events.map((e) => e.eventType),
      fulfillmentOrder,
      attempts: fulfillmentOrder?.attempts ?? [],
    };
  }

  const reaches = (orderId: string, status: string, timeoutMs = 30_000) =>
    waitFor(
      async () => {
        const state = await stateOf(orderId);
        return state.order.status === status ? state : null;
      },
      { timeoutMs },
    );

  const attemptReaches = (orderId: string, attemptNumber: number, status: string) =>
    waitFor(
      async () => {
        const state = await stateOf(orderId);
        const attempt = state.attempts.find((a) => a.attemptNumber === attemptNumber);
        return attempt?.status === status ? attempt : null;
      },
      { timeoutMs: 30_000 },
    );

  it('Scenario A: payment confirmed → QUEUED → PROCESSING → SUCCESS → FULFILLED, fully recorded', async () => {
    const { provider, source } = await startWorkers('SUCCESS');
    const { order, requestId } = await paidOrder(500);

    const state = await reaches(order.id, 'FULFILLED');
    expect(state.steps.sort()).toEqual(
      [
        'PAYMENT_PENDING>PAID',
        'PAID>QUEUED',
        'QUEUED>PROCESSING',
        'PROCESSING>FULFILLMENT_PENDING',
        'FULFILLMENT_PENDING>FULFILLED',
      ].sort(),
    );
    expect(state.events.sort()).toEqual(
      [
        'PAYMENT_CONFIRMED',
        'FULFILLMENT_REQUESTED',
        'FULFILLMENT_STARTED',
        'FULFILLMENT_COMPLETED',
      ].sort(),
    );
    expect(state.order.fulfilledAt).not.toBeNull();
    expect(state.fulfillmentOrder).toMatchObject({
      requestedAmount: 500,
      fulfilledAmount: 500,
      remainingAmount: 0,
      status: 'FULFILLED',
      leaseToken: null,
      leaseExpiresAt: null,
    });
    const [attempt] = state.attempts;
    expect(attempt).toMatchObject({
      attemptNumber: 1,
      provider: provider.code,
      clientReference: `FULFILLMENT-${order.id}-1`,
      requestedAmount: 500,
      fulfilledAmount: 500,
      status: 'SUCCEEDED',
      allocationId: expect.any(String),
    });
    expect(attempt!.externalReference).toMatch(/^MOCK-/);
    const allocation = await prisma.fulfillmentAllocation.findUniqueOrThrow({
      where: { id: attempt!.allocationId! },
    });
    expect(allocation).toMatchObject({
      sourceId: source.id,
      amount: 500,
      consumedAmount: 500,
      releasedAmount: 0,
      status: 'CONSUMED',
      routingStrategy: 'SMART_V1',
    });
    expect(attempt!.statusHistory.map((h) => `${h.fromStatus}>${h.toStatus}`).sort()).toEqual(
      ['null>EXECUTING', 'EXECUTING>SUCCEEDED'].sort(),
    );

    // Traceable by order, attempt, references, event and the payment's request id.
    const fulfilled = state.history.find((h) => h.toStatus === 'FULFILLED')!;
    const requested = await prisma.outboxEvent.findFirstOrThrow({
      where: { aggregateId: order.id, eventType: 'FULFILLMENT_REQUESTED' },
    });
    expect(fulfilled).toMatchObject({ actorType: 'SYSTEM', requestId });
    expect(fulfilled.metadata).toMatchObject({
      eventId: requested.id,
      attemptId: attempt!.id,
      clientReference: attempt!.clientReference,
      providerReference: attempt!.externalReference,
      provider: provider.code,
    });
    expect(provider.callsFor(order.id)).toHaveLength(1);
    expect(provider.callsFor(order.id)[0]).toEqual({
      clientReference: `FULFILLMENT-${order.id}-1`,
      recipient: { type: 'ROBLOX_USER', identifier: 'TestPlayer', externalUserId: '1234567' },
      amount: 500,
      correlationId: requestId,
    });
  });

  it('Scenario B: RETRYABLE_FAILURE → FAILED → RETRYING → same reference → FULFILLED', async () => {
    const { provider, mock } = await startWorkers('RETRYABLE_FAILURE');
    const { order } = await paidOrder();
    await attemptReaches(order.id, 1, 'FAILED_RETRYABLE');
    await reaches(order.id, 'RETRYING');
    mock.setScenario('SUCCESS');
    // Outages (also of backlog orders sharing this source) may have taken it out of routing;
    // the health check job brings it back once the provider answers.
    await recoverSources();

    const state = await reaches(order.id, 'FULFILLED', 60_000);
    expect(state.steps).toEqual(
      expect.arrayContaining(['PROCESSING>FAILED', 'FAILED>RETRYING', 'RETRYING>PROCESSING']),
    );
    expect(state.attempts.map((a) => [a.attemptNumber, a.status, a.clientReference])).toEqual([
      [1, 'FAILED_RETRYABLE', `FULFILLMENT-${order.id}-1`],
      [2, 'SUCCEEDED', `FULFILLMENT-${order.id}-1`],
    ]);
    expect(state.attempts[0]!.errorCode).toBe('UNAVAILABLE');
    expect(state.events).toEqual(
      expect.arrayContaining([
        'FULFILLMENT_FAILED',
        'FULFILLMENT_RETRYING',
        'FULFILLMENT_COMPLETED',
      ]),
    );
    expect(new Set(provider.callsFor(order.id).map((c) => c.clientReference)).size).toBe(1);
  }, 90_000);

  it('Scenario C: PENDING → FULFILLMENT_PENDING → verify → SUCCESS → FULFILLED, one submission', async () => {
    const { provider, mock } = await startWorkers('PENDING');
    const { order } = await paidOrder();
    const pending = await attemptReaches(order.id, 1, 'VERIFYING');
    expect((await stateOf(order.id)).order.status).toBe('FULFILLMENT_PENDING');
    expect(pending.externalReference).toMatch(/^MOCK-/);
    mock.settle(pending.externalReference!, 'SUCCEEDED');

    const state = await reaches(order.id, 'FULFILLED');
    expect(state.steps).toEqual(
      expect.arrayContaining(['PROCESSING>FULFILLMENT_PENDING', 'FULFILLMENT_PENDING>FULFILLED']),
    );
    expect(state.events).toContain('FULFILLMENT_PENDING');
    expect(state.attempts).toHaveLength(1);
    expect(state.attempts[0]).toMatchObject({ status: 'SUCCEEDED', fulfilledAmount: 500 });
    expect(provider.callsFor(order.id)).toHaveLength(1);
  }, 60_000);

  it('Scenario D: SUCCEEDED_BUT_TIMED_OUT → verify → FULFILLED, no second delivery', async () => {
    const { provider, mock } = await startWorkers('SUCCEEDED_BUT_TIMED_OUT');
    const { order } = await paidOrder();
    const unknown = await attemptReaches(order.id, 1, 'UNKNOWN');
    expect(unknown.errorCode).toBe('TIMEOUT');
    mock.setScenario('SUCCESS');

    const state = await reaches(order.id, 'FULFILLED');
    expect(state.attempts).toHaveLength(1);
    expect(state.attempts[0]).toMatchObject({ status: 'SUCCEEDED', fulfilledAmount: 500 });
    expect(provider.callsFor(order.id)).toHaveLength(1);
  }, 60_000);

  it('Scenario E: PERMANENT_FAILURE → FAILED_PERMANENTLY, no retry', async () => {
    const { provider, config } = await startWorkers('PERMANENT_FAILURE');
    const { order } = await paidOrder();
    const state = await reaches(order.id, 'FAILED_PERMANENTLY');
    expect(state.steps).toEqual(
      expect.arrayContaining(['PROCESSING>FAILED', 'FAILED>FAILED_PERMANENTLY']),
    );
    expect(state.attempts).toMatchObject([{ status: 'FAILED_PERMANENT', errorCode: 'REJECTED' }]);
    expect(state.fulfillmentOrder?.status).toBe('FAILED');
    expect(state.history.find((h) => h.toStatus === 'FAILED_PERMANENTLY')!.metadata).toMatchObject({
      errorCode: 'REJECTED',
      stopReason: 'REJECTED',
    });

    const requested = await prisma.outboxEvent.findFirstOrThrow({
      where: { aggregateId: order.id, eventType: 'FULFILLMENT_REQUESTED' },
    });
    const registry = new BullMqQueueRegistry(config);
    registries.push(registry);
    const job = await waitFor(async () => {
      const found = await registry.get('fulfillment').getJob(requested.id);
      return found?.finishedOn ? found : null;
    });
    expect(await job.isCompleted()).toBe(true);
    expect(provider.callsFor(order.id)).toHaveLength(1);
  });

  it('Scenario F: PARTIAL 500 of 1000 → PARTIALLY_FULFILLED → remaining 500 → FULFILLED', async () => {
    const { provider, mock } = await startWorkers('PARTIAL');
    const { order } = await paidOrder(1000);
    await attemptReaches(order.id, 1, 'PARTIAL');
    const partial = await reaches(order.id, 'RETRYING');
    expect(partial.fulfillmentOrder).toMatchObject({ fulfilledAmount: 500, remainingAmount: 500 });
    expect(partial.steps).toContain('PROCESSING>PARTIALLY_FULFILLED');
    mock.setScenario('SUCCESS');

    const state = await reaches(order.id, 'FULFILLED');
    expect(
      state.attempts.map((a) => [
        a.clientReference,
        a.requestedAmount,
        a.fulfilledAmount,
        a.status,
      ]),
    ).toEqual([
      [`FULFILLMENT-${order.id}-1`, 1000, 500, 'PARTIAL'],
      [`FULFILLMENT-${order.id}-2`, 500, 500, 'SUCCEEDED'],
    ]);
    expect(state.fulfillmentOrder).toMatchObject({
      requestedAmount: 1000,
      fulfilledAmount: 1000,
      remainingAmount: 0,
      status: 'FULFILLED',
    });
    expect(state.events).toContain('FULFILLMENT_PARTIAL');
    expect(provider.callsFor(order.id).map((c) => c.amount)).toEqual([1000, 500]);
  }, 60_000);

  it('INVALID_RECIPIENT → FAILED_PERMANENTLY before any delivery attempt', async () => {
    const { provider } = await startWorkers('INVALID_RECIPIENT');
    const { order } = await paidOrder();
    const state = await reaches(order.id, 'FAILED_PERMANENTLY');
    expect(state.attempts).toEqual([]);
    expect(state.history.find((h) => h.toStatus === 'FAILED')!.metadata).toMatchObject({
      errorCode: 'INVALID_RECIPIENT',
    });
    expect(provider.callsFor(order.id)).toEqual([]);
  });

  it('UNAVAILABLE provider → RETRYING (not a permanent failure) → FULFILLED once it is back', async () => {
    const { mock } = await startWorkers('UNAVAILABLE');
    const { order } = await paidOrder();
    const retrying = await reaches(order.id, 'RETRYING');
    expect(retrying.attempts).toEqual([]);
    expect(retrying.history.find((h) => h.toStatus === 'FAILED')!.metadata).toMatchObject({
      errorCode: 'UNAVAILABLE',
    });
    mock.setScenario('SUCCESS');
    // Outages (also of backlog orders sharing this source) may have taken it out of routing;
    // the health check job brings it back once the provider answers.
    await recoverSources();
    await reaches(order.id, 'FULFILLED', 60_000);
  }, 90_000);

  it('Scenario G: the same FULFILLMENT_REQUESTED ×10 on two workers → one fulfillment', async () => {
    const { provider, config } = await startWorkers('SUCCESS', { workers: 2 });
    const { order } = await paidOrder();
    const requested = await waitFor(() =>
      prisma.outboxEvent.findFirst({
        where: { aggregateId: order.id, eventType: 'FULFILLMENT_REQUESTED' },
      }),
    );
    const registry = new BullMqQueueRegistry(config);
    registries.push(registry);
    const publisher = new BullMqQueuePublisher(registry);
    // Redelivery beyond BullMQ's job-id dedupe: ten more jobs for the same event.
    await Promise.all(
      Array.from({ length: 10 }, () =>
        publisher.publish(
          FULFILLMENT_REQUESTED_JOB,
          {
            eventId: requested.id,
            eventType: requested.eventType,
            aggregateType: requested.aggregateType,
            aggregateId: requested.aggregateId,
          },
          { jobId: randomUUID() },
        ),
      ),
    );

    await reaches(order.id, 'FULFILLED');
    const queue = registry.get('fulfillment');
    await waitFor(
      async () => {
        const counts = await queue.getJobCounts('waiting', 'active', 'delayed');
        return Object.values(counts).every((count) => count === 0);
      },
      { timeoutMs: 45_000 },
    );
    const state = await stateOf(order.id);
    expect(state.attempts).toHaveLength(1);
    expect(state.steps.filter((s) => s === 'QUEUED>PROCESSING')).toHaveLength(1);
    expect(state.steps.filter((s) => s.endsWith('>FULFILLED'))).toHaveLength(1);
    expect(state.events.filter((e) => e === 'FULFILLMENT_COMPLETED')).toHaveLength(1);
    expect(provider.callsFor(order.id)).toHaveLength(1);
  }, 75_000);

  it('Phase 11: a paid Telegram Stars order is fulfilled to the Telegram user from Stars stock', async () => {
    const { provider, telegramSources } = await startWorkers('SUCCESS');
    const { order } = await paidOrder(250, undefined, {
      productLine: 'TELEGRAM_STARS',
      platform: 'TELEGRAM',
      fulfillmentType: 'RECIPIENT_FULFILLMENT',
      recipientType: 'TELEGRAM_USER',
      recipientUsername: 'durov_team',
      recipientRobloxUserId: null,
    });
    const state = await reaches(order.id, 'FULFILLED');
    const allocation = await prisma.fulfillmentAllocation.findUniqueOrThrow({
      where: { id: state.attempts[0]!.allocationId! },
    });
    expect(allocation.sourceId).toBe(telegramSources.stars.id);
    expect(provider.callsFor(order.id)).toEqual([
      expect.objectContaining({
        recipient: { type: 'TELEGRAM_USER', identifier: 'durov_team', externalUserId: null },
        amount: 250,
      }),
    ]);
  });

  it('Phase 12: Telegram Premium uses the recipient mock provider from Premium stock', async () => {
    const { provider, telegramSources } = await startWorkers('SUCCESS');
    const { order } = await paidOrder(3, undefined, {
      productLine: 'TELEGRAM_PREMIUM',
      platform: 'TELEGRAM',
      fulfillmentType: 'RECIPIENT_FULFILLMENT',
      recipientType: 'TELEGRAM_USER',
      recipientUsername: 'premium_user',
      recipientRobloxUserId: null,
    });
    const state = await reaches(order.id, 'FULFILLED');
    const allocation = await prisma.fulfillmentAllocation.findUniqueOrThrow({
      where: { id: state.attempts[0]!.allocationId! },
    });
    expect(allocation.sourceId).toBe(telegramSources.premium.id);
    expect(provider.callsFor(order.id)).toEqual([
      expect.objectContaining({
        recipient: { type: 'TELEGRAM_USER', identifier: 'premium_user', externalUserId: null },
        amount: 3,
      }),
    ]);
  });

  it('Phase 11: a paid Telegram account order is delivered from account stock without a recipient', async () => {
    const { provider, telegramSources } = await startWorkers('SUCCESS');
    const { order } = await paidOrder(
      1,
      undefined,
      {
        productLine: 'TELEGRAM_ACCOUNT',
        platform: 'TELEGRAM',
        fulfillmentType: 'DIGITAL_DELIVERY',
        recipientType: null,
        recipientUsername: null,
        recipientRobloxUserId: null,
      },
      telegramSources.accounts.id,
    );
    const state = await reaches(order.id, 'FULFILLED');
    const allocation = await prisma.fulfillmentAllocation.findUniqueOrThrow({
      where: { id: state.attempts[0]!.allocationId! },
    });
    expect(allocation).toMatchObject({
      sourceId: telegramSources.accounts.id,
      amount: 1,
      status: 'CONSUMED',
    });
    expect(provider.callsFor(order.id)).toEqual([
      expect.objectContaining({ recipient: null, amount: 1 }),
    ]);
  });
});
