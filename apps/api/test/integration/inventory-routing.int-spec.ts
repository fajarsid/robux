import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { FulfillmentAllocationService } from '../../src/modules/fulfillment/application/fulfillment-allocation.service';
import { FulfillmentProviderRegistry } from '../../src/modules/fulfillment/application/fulfillment-provider.registry';
import { SourceHealthCheckService } from '../../src/modules/fulfillment/application/source-health-check.service';
import type { FulfillmentWorkflow } from '../../src/modules/fulfillment/domain/fulfillment-workflow.repository';
import { PrismaFulfillmentWorkflowRepository } from '../../src/modules/fulfillment/infrastructure/prisma-fulfillment-workflow.repository';
import { MockFulfillmentProvider } from '../../src/modules/fulfillment/infrastructure/providers/mock/mock-fulfillment.provider';
import {
  consumeAllocation,
  recordProviderOutcome,
  releaseAllocation,
} from '../../src/modules/inventory/infrastructure/inventory-ledger.writer';
import { PrismaSourceCandidateReader } from '../../src/modules/inventory/infrastructure/prisma-source-candidate.reader';
import { PrismaSourceHealthRepository } from '../../src/modules/inventory/infrastructure/prisma-source-health.repository';
import { createOrder, createProductWithPrice, createSource } from './support/fixtures';
import { asPrismaService, createTestPrisma, expectDatabaseError } from './support/test-database';

/**
 * Inventory against PostgreSQL: routing + atomic reservation under concurrency, consume/release,
 * low-balance edge trigger, source health and the database invariants. Each test routes over its
 * own provider code, so sources other suites left in the shared database are not candidates.
 */
describe('inventory: routing, reservation and ledger', () => {
  let prisma: PrismaClient;
  let workflows: PrismaFulfillmentWorkflowRepository;
  const trace = { eventId: randomUUID(), requestId: 'req-inventory' };

  beforeAll(() => {
    prisma = createTestPrisma();
    workflows = new PrismaFulfillmentWorkflowRepository(asPrismaService(prisma));
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** A routing service that only knows `provider`. */
  function allocatorFor(provider: string) {
    const registry = new FulfillmentProviderRegistry([
      Object.assign(new MockFulfillmentProvider({ scenario: 'SUCCESS', balance: 10n ** 12n }), {
        code: provider,
      }),
    ]);
    return {
      registry,
      service: new FulfillmentAllocationService(
        workflows,
        new PrismaSourceCandidateReader(asPrismaService(prisma)),
        registry,
      ),
    };
  }

  async function workflowFor(robuxAmount: number): Promise<FulfillmentWorkflow> {
    const { product, price } = await createProductWithPrice(prisma, { robuxAmount });
    const order = await createOrder(prisma, { product, price, status: 'QUEUED' });
    const now = new Date();
    const result = await workflows.acquire(order.id, {
      token: randomUUID(),
      now,
      expiresAt: new Date(now.getTime() + 60_000),
    });
    if (result.kind !== 'ACQUIRED') {
      throw new Error(result.kind);
    }
    return result.workflow;
  }

  const sourceRow = (id: string) => prisma.fulfillmentSource.findUniqueOrThrow({ where: { id } });
  const provider = () => `inv-${randomUUID().slice(0, 8)}`;

  it('same source, two orders at once: only one reserves, the other gets an explicit no-source outcome', async () => {
    const code = provider();
    const source = await createSource(prisma, 1_000n, { provider: code });
    const { service } = allocatorFor(code);
    const [a, b] = await Promise.all([workflowFor(700), workflowFor(700)]);

    const outcomes = await Promise.all([
      service.allocationFor(a, trace),
      service.allocationFor(b, trace),
    ]);
    expect(outcomes.map((o) => o.kind).sort()).toEqual(['ALLOCATED', 'NO_ELIGIBLE_SOURCE']);
    expect(await sourceRow(source.id)).toMatchObject({
      availableBalance: 300n,
      reservedBalance: 700n,
    });
  });

  it('ten concurrent orders on one source pool: never negative, never over-reserved', async () => {
    const code = provider();
    const source = await createSource(prisma, 1_000n, { provider: code });
    const { service } = allocatorFor(code);
    const orders = await Promise.all(Array.from({ length: 10 }, () => workflowFor(150)));

    const outcomes = await Promise.all(orders.map((w) => service.allocationFor(w, trace)));
    const allocated = outcomes.filter((o) => o.kind === 'ALLOCATED');
    expect(allocated).toHaveLength(6);
    expect(await sourceRow(source.id)).toMatchObject({
      availableBalance: 100n,
      reservedBalance: 900n,
    });
    const ledger = await prisma.sourceBalanceLog.findMany({ where: { sourceId: source.id } });
    expect(ledger.filter((l) => l.reason === 'RESERVE')).toHaveLength(6);
    expect(ledger.every((l) => l.availableAfter >= 0n && l.reservedAfter >= 0n)).toBe(true);
    // One allocation per allocated order, none for the others.
    for (const order of orders) {
      const count = await prisma.fulfillmentAllocation.count({
        where: { fulfillmentOrderId: order.fulfillmentOrderId },
      });
      expect(count).toBeLessThanOrEqual(1);
    }
  });

  it('ten Telegram account orders racing for one item produce one unique reservation', async () => {
    const code = provider();
    const source = await createSource(prisma, 1n, {
      provider: code,
      productLine: 'TELEGRAM_ACCOUNT',
    });
    const { product, price } = await createProductWithPrice(prisma, {
      robuxAmount: 1,
      productLine: 'TELEGRAM_ACCOUNT',
    });
    await prisma.digitalInventoryItem.create({
      data: {
        productId: product.id,
        sourceId: source.id,
        encryptedPayload: Buffer.alloc(40, 7),
        keyVersion: 1,
      },
    });
    const orders = await Promise.all(
      Array.from({ length: 10 }, async () => {
        const order = await createOrder(prisma, {
          product,
          price,
          status: 'QUEUED',
          snapshot: {
            productLine: 'TELEGRAM_ACCOUNT',
            platform: 'TELEGRAM',
            fulfillmentType: 'DIGITAL_DELIVERY',
            recipientType: null,
            recipientUsername: null,
            recipientRobloxUserId: null,
          },
        });
        const now = new Date();
        const acquired = await workflows.acquire(order.id, {
          token: randomUUID(),
          now,
          expiresAt: new Date(now.getTime() + 60_000),
        });
        if (acquired.kind !== 'ACQUIRED') throw new Error(acquired.kind);
        return acquired.workflow;
      }),
    );
    const { service } = allocatorFor(code);
    const outcomes = await Promise.all(orders.map((order) => service.allocationFor(order, trace)));
    expect(outcomes.filter((outcome) => outcome.kind === 'ALLOCATED')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.kind === 'NO_ELIGIBLE_SOURCE')).toHaveLength(9);
    const item = await prisma.digitalInventoryItem.findFirstOrThrow({
      where: { productId: product.id },
    });
    expect(item.status).toBe('RESERVED');
    expect(item.orderId).toBeTruthy();
    expect(item.allocationId).toBeTruthy();
    expect(
      await prisma.digitalInventoryItem.count({
        where: { status: 'RESERVED', sourceId: source.id },
      }),
    ).toBe(1);
  });

  it('ten Telegram account items make ten unique reservations under concurrent orders', async () => {
    const code = provider();
    const source = await createSource(prisma, 10n, {
      provider: code,
      productLine: 'TELEGRAM_ACCOUNT',
    });
    const { product, price } = await createProductWithPrice(prisma, {
      robuxAmount: 1,
      productLine: 'TELEGRAM_ACCOUNT',
    });
    await prisma.digitalInventoryItem.createMany({
      data: Array.from({ length: 10 }, () => ({
        productId: product.id,
        sourceId: source.id,
        encryptedPayload: Buffer.alloc(40, 8),
        keyVersion: 1,
      })),
    });
    const orders = await Promise.all(
      Array.from({ length: 10 }, async () => {
        const order = await createOrder(prisma, {
          product,
          price,
          status: 'QUEUED',
          snapshot: {
            productLine: 'TELEGRAM_ACCOUNT',
            platform: 'TELEGRAM',
            fulfillmentType: 'DIGITAL_DELIVERY',
            recipientType: null,
            recipientUsername: null,
            recipientRobloxUserId: null,
          },
        });
        const now = new Date();
        const acquired = await workflows.acquire(order.id, {
          token: randomUUID(),
          now,
          expiresAt: new Date(now.getTime() + 60_000),
        });
        if (acquired.kind !== 'ACQUIRED') throw new Error(acquired.kind);
        return acquired.workflow;
      }),
    );
    const { service } = allocatorFor(code);
    const outcomes = await Promise.all(orders.map((order) => service.allocationFor(order, trace)));
    expect(outcomes.filter((outcome) => outcome.kind === 'ALLOCATED')).toHaveLength(10);
    const reservations = await prisma.digitalInventoryItem.findMany({
      where: { sourceId: source.id, status: 'RESERVED' },
    });
    expect(reservations).toHaveLength(10);
    expect(new Set(reservations.map((item) => item.orderId)).size).toBe(10);
    expect(new Set(reservations.map((item) => item.id)).size).toBe(10);
  });

  it('two sources, two 1500 orders at once: one split plan, no over-allocation', async () => {
    const code = provider();
    const a = await createSource(prisma, 1_000n, { provider: code });
    const b = await createSource(prisma, 1_000n, { provider: code });
    const { service } = allocatorFor(code);
    const orders = await Promise.all([workflowFor(1500), workflowFor(1500)]);

    const outcomes = await Promise.all(orders.map((w) => service.allocationFor(w, trace)));
    expect(outcomes.map((o) => o.kind).sort()).toEqual(['ALLOCATED', 'NO_ELIGIBLE_SOURCE']);
    const [rowA, rowB] = await Promise.all([sourceRow(a.id), sourceRow(b.id)]);
    expect(rowA.reservedBalance + rowB.reservedBalance).toBe(1_500n);
    expect(rowA.availableBalance + rowB.availableBalance).toBe(500n);
    const winner = orders[outcomes.findIndex((o) => o.kind === 'ALLOCATED')]!;
    const allocations = await prisma.fulfillmentAllocation.findMany({
      where: { fulfillmentOrderId: winner.fulfillmentOrderId },
    });
    expect(allocations.map((x) => x.amount).sort((x, y) => x - y)).toEqual([500, 1000]);
    expect(allocations.every((x) => x.routingStrategy === 'SMART_V1')).toBe(true);
    expect(allocations[0]!.routingDecision).toMatchObject({ sourceCount: 2, amount: 1500 });
  });

  it('routes past a disabled (kill switch) and an unavailable source', async () => {
    const code = provider();
    await createSource(prisma, 9_000n, { provider: code, status: 'DISABLED' });
    await createSource(prisma, 9_000n, { provider: code, health: 'UNAVAILABLE' });
    const usable = await createSource(prisma, 2_000n, { provider: code });
    const { service } = allocatorFor(code);
    const outcome = await service.allocationFor(await workflowFor(1000), trace);
    expect(outcome).toMatchObject({ kind: 'ALLOCATED', allocation: { sourceId: usable.id } });
  });

  it('snapshots the cost at allocation time; later cost changes do not rewrite it', async () => {
    const code = provider();
    const source = await createSource(prisma, 5_000n, { provider: code, costPerUnit: '95.5000' });
    const { service } = allocatorFor(code);
    const outcome = await service.allocationFor(await workflowFor(1000), trace);
    if (outcome.kind !== 'ALLOCATED') {
      throw new Error('expected an allocation');
    }
    await prisma.fulfillmentSource.update({
      where: { id: source.id },
      data: { costPerUnit: '120' },
    });
    const allocation = await prisma.fulfillmentAllocation.findUniqueOrThrow({
      where: { id: outcome.allocation.id },
    });
    expect(allocation.unitCostSnapshot?.toFixed(4)).toBe('95.5000');
  });

  it('consume and release keep available + reserved consistent and settle the allocation once', async () => {
    const code = provider();
    const source = await createSource(prisma, 5_000n, { provider: code });
    const { service } = allocatorFor(code);
    const outcome = await service.allocationFor(await workflowFor(1000), trace);
    if (outcome.kind !== 'ALLOCATED') {
      throw new Error('expected an allocation');
    }
    const id = outcome.allocation.id;
    await prisma.$transaction((tx) => consumeAllocation(tx, id, 300, null));
    expect(await sourceRow(source.id)).toMatchObject({
      availableBalance: 4_000n,
      reservedBalance: 700n,
    });
    expect(await prisma.$transaction((tx) => releaseAllocation(tx, id, null, 'test'))).toBe(700);
    // Released twice: the second is a no-op.
    expect(await prisma.$transaction((tx) => releaseAllocation(tx, id, null, 'test'))).toBe(0);
    expect(await sourceRow(source.id)).toMatchObject({
      availableBalance: 4_700n,
      reservedBalance: 0n,
    });
    expect(await prisma.fulfillmentAllocation.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: 'CONSUMED',
      consumedAmount: 300,
      releasedAmount: 700,
    });
    await expect(prisma.$transaction((tx) => consumeAllocation(tx, id, 1, null))).rejects.toThrow();
  });

  it('low balance: one event per crossing, none while it stays low, re-armed after recovery', async () => {
    const code = provider();
    const source = await createSource(prisma, 1_000n, {
      provider: code,
      lowBalanceThreshold: 800n,
    });
    const { service } = allocatorFor(code);
    const allocations: string[] = [];
    // 1000 → 900 → 800 → 700 → 600: crosses below 800 once.
    for (let i = 0; i < 4; i += 1) {
      const outcome = await service.allocationFor(await workflowFor(100), trace);
      if (outcome.kind === 'ALLOCATED') {
        allocations.push(outcome.allocation.id);
      }
    }
    const events = () =>
      prisma.outboxEvent.findMany({
        where: { aggregateId: source.id, eventType: 'SOURCE_LOW_BALANCE' },
      });
    expect(await events()).toHaveLength(1);
    expect((await events())[0]!.payload).toMatchObject({
      sourceId: source.id,
      availableBalance: '700',
      lowBalanceThreshold: '800',
    });
    expect((await sourceRow(source.id)).lowBalanceSince).not.toBeNull();

    for (const id of allocations) {
      await prisma.$transaction((tx) => releaseAllocation(tx, id, null, 'test'));
    }
    expect((await sourceRow(source.id)).lowBalanceSince).toBeNull();
    const again = await service.allocationFor(await workflowFor(300), trace);
    expect(again.kind).toBe('ALLOCATED');
    expect(await events()).toHaveLength(2);
  });

  it('health: one failure degrades, three in a row take the source out once; success restores', async () => {
    const code = provider();
    const source = await createSource(prisma, 1_000n, { provider: code });
    const fail = () =>
      prisma.$transaction((tx) => recordProviderOutcome(tx, source.id, 'PROVIDER_FAILURE', null));
    await fail();
    expect(await sourceRow(source.id)).toMatchObject({
      health: 'DEGRADED',
      consecutiveFailures: 1,
    });
    await fail();
    await fail();
    await fail();
    expect(await sourceRow(source.id)).toMatchObject({
      health: 'UNAVAILABLE',
      consecutiveFailures: 4,
    });
    expect(
      await prisma.outboxEvent.count({
        where: { aggregateId: source.id, eventType: 'SOURCE_UNAVAILABLE' },
      }),
    ).toBe(1);

    // The health check probes the provider and brings the source back.
    const { registry } = allocatorFor(code);
    const check = new SourceHealthCheckService(
      new PrismaSourceHealthRepository(asPrismaService(prisma)),
      registry,
    );
    expect(await check.checkUnavailableSources()).toMatchObject({ healthy: expect.any(Number) });
    expect(await sourceRow(source.id)).toMatchObject({ health: 'HEALTHY', consecutiveFailures: 0 });
  });

  it('database constraints hold the invariants even against direct writes', async () => {
    const code = provider();
    const source = await createSource(prisma, 1_000n, { provider: code });
    await expectDatabaseError(
      prisma.fulfillmentSource.update({
        where: { id: source.id },
        data: { availableBalance: -1n },
      }),
      { constraint: 'fulfillment_sources_available_non_negative' },
    );
    const { service } = allocatorFor(code);
    const outcome = await service.allocationFor(await workflowFor(500), trace);
    if (outcome.kind !== 'ALLOCATED') {
      throw new Error('expected an allocation');
    }
    const id = outcome.allocation.id;
    await expectDatabaseError(
      prisma.fulfillmentAllocation.update({ where: { id }, data: { consumedAmount: 501 } }),
      // More than the allocation: refused (by the RESERVED and the within-amount CHECKs).
      { code: '23514' },
    );
    await expectDatabaseError(
      prisma.fulfillmentAllocation.update({ where: { id }, data: { releasedAmount: 10 } }),
      { constraint: 'fulfillment_allocations_reserved_unsettled' },
    );
    await expectDatabaseError(
      prisma.fulfillmentSource.update({
        where: { id: source.id },
        data: { consecutiveFailures: -1 },
      }),
      { constraint: 'fulfillment_sources_failures_non_negative' },
    );
  });
});
