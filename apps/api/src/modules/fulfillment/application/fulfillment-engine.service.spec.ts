import type { FulfillmentTypeName, ProductLineName } from '@robux/shared';
import type { OrderStatus, SourceHealth, SourceStatus } from '../../../generated/prisma/enums';
import { ReservationConflictError } from '../../inventory/domain/reservation-conflict.error';
import type { PlannedAllocation, SourceCandidate } from '../../inventory/domain/routing';
import type { SourceCandidateReader } from '../../inventory/domain/source-candidate.reader';
import { assertTransition } from '../../orders/domain/order-state-machine';
import type {
  FulfillmentProvider,
  FulfillmentRecipient,
  FulfillmentRequest,
  FulfillmentResult,
} from '../domain/fulfillment-provider';
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
} from '../domain/fulfillment-workflow.repository';
import { MockFulfillmentProvider } from '../infrastructure/providers/mock/mock-fulfillment.provider';
import type { MockScenario } from '../infrastructure/providers/mock/mock-scenario';
import { FulfillmentAllocationService } from './fulfillment-allocation.service';
import { FulfillmentAttemptExecutor } from './fulfillment-attempt.executor';
import { FulfillmentAttemptVerifier } from './fulfillment-attempt.verifier';
import { FulfillmentEngine, type FulfillmentRun } from './fulfillment-engine.service';
import { FulfillmentProviderRegistry } from './fulfillment-provider.registry';

const LIVE = ['PENDING', 'EXECUTING', 'VERIFYING', 'UNKNOWN'];

interface MemorySource {
  id: string;
  provider: string;
  productLine: ProductLineName;
  status: SourceStatus;
  health: SourceHealth;
  available: bigint;
  reserved: bigint;
  priority: number;
  failures: number;
}

interface MemoryAllocation {
  id: string;
  sourceId: string;
  amount: number;
  consumed: number;
  released: number;
  status: 'RESERVED' | 'CONSUMED' | 'RELEASED';
}

/**
 * The repository contract in memory: lease, conditional writes, the order state machine and the
 * inventory ledger rules (atomic reservation, consume, release, health), so the engine's decisions
 * are checked against the same rules PostgreSQL enforces.
 */
class InMemoryWorkflows implements FulfillmentWorkflowRepository, SourceCandidateReader {
  orderStatus: OrderStatus = 'QUEUED';
  productLine: ProductLineName = 'ROBLOX_ROBUX';
  fulfillmentType: FulfillmentTypeName = 'BALANCE_PURCHASE';
  recipient: FulfillmentRecipient | null = {
    type: 'ROBLOX_USER',
    identifier: 'mock-valid-user',
    externalUserId: null,
  };
  method: 'INSTANT' | 'GAMEPASS' = 'INSTANT';
  requested = 1000;
  fulfilled = 0;
  lease: { token: string; expiresAt: Date } | null = null;
  attempts: AttemptSnapshot[] = [];
  history: string[] = [];
  events: string[] = [];
  failNextApply = false;
  sources = new Map<string, MemorySource>();
  allocations: MemoryAllocation[] = [];

  addSource(id: string, available: bigint, overrides: Partial<MemorySource> = {}) {
    this.sources.set(id, {
      id,
      provider: 'mock',
      productLine: 'ROBLOX_ROBUX',
      status: 'ACTIVE',
      health: 'HEALTHY',
      available,
      reserved: 0n,
      priority: 100,
      failures: 0,
      ...overrides,
    });
  }

  async candidates(line: ProductLineName): Promise<Omit<SourceCandidate, 'providerConfigured'>[]> {
    return [...this.sources.values()]
      .filter((s) => s.productLine === line)
      .map((s) => ({
        id: s.id,
        name: s.id,
        provider: s.provider,
        status: s.status,
        health: s.health,
        available: s.available,
        priority: s.priority,
        costPerUnit: null,
      }));
  }

  async acquire(_orderId: string, lease: { token: string; now: Date; expiresAt: Date }) {
    if (!ENGINE_ORDER_STATUSES.includes(this.orderStatus) || this.method !== 'INSTANT') {
      return { kind: 'NOT_ELIGIBLE', orderStatus: this.orderStatus, method: this.method } as const;
    }
    if (this.lease && this.lease.expiresAt > lease.now) {
      return { kind: 'BUSY' } as const;
    }
    this.lease = { token: lease.token, expiresAt: lease.expiresAt };
    return { kind: 'ACQUIRED', workflow: this.snapshot(lease.token) } satisfies AcquireResult;
  }

  async start(workflow: FulfillmentWorkflow) {
    this.holds(workflow.leaseToken);
    if (this.orderStatus !== workflow.orderStatus) {
      return false;
    }
    this.transition(workflow.orderStatus, 'PROCESSING', 'FULFILLMENT_STARTED');
    return true;
  }

  async reserve(
    workflow: FulfillmentWorkflow,
    plan: { allocations: readonly PlannedAllocation[] },
  ): Promise<AllocationSnapshot[]> {
    this.holds(workflow.leaseToken);
    if (this.allocations.some((a) => a.status === 'RESERVED')) {
      throw new WorkflowConflictError('open allocation exists');
    }
    for (const planned of plan.allocations) {
      const source = this.sources.get(planned.sourceId)!;
      const ok =
        source.status === 'ACTIVE' &&
        ['HEALTHY', 'DEGRADED'].includes(source.health) &&
        source.available >= BigInt(planned.amount);
      if (!ok) {
        throw new ReservationConflictError(planned.sourceId);
      }
    }
    const created = plan.allocations.map((planned) => {
      const source = this.sources.get(planned.sourceId)!;
      source.available -= BigInt(planned.amount);
      source.reserved += BigInt(planned.amount);
      const allocation: MemoryAllocation = {
        id: `allocation-${this.allocations.length + 1}`,
        sourceId: planned.sourceId,
        amount: planned.amount,
        consumed: 0,
        released: 0,
        status: 'RESERVED',
      };
      this.allocations.push(allocation);
      return this.allocationSnapshot(allocation);
    });
    return created;
  }

  async reload(workflow: FulfillmentWorkflow) {
    return this.snapshot(workflow.leaseToken);
  }

  async openAttempt(input: OpenAttempt) {
    this.holds(input.leaseToken);
    if (this.attempts.some((a) => LIVE.includes(a.status))) {
      throw new WorkflowConflictError('live attempt exists');
    }
    const attempt: AttemptSnapshot = {
      id: `attempt-${input.attemptNumber}`,
      attemptNumber: input.attemptNumber,
      provider: input.provider,
      clientReference: input.clientReference,
      requestedAmount: input.requestedAmount,
      status: 'EXECUTING',
      providerReference: null,
      allocationId: input.allocationId,
    };
    this.attempts.push(attempt);
    return { ...attempt };
  }

  async apply({ workflow, attempt, allocation, resolution, plan }: ApplyPlan) {
    if (this.failNextApply) {
      this.failNextApply = false;
      throw new Error('database unavailable');
    }
    this.holds(workflow.leaseToken);
    if (attempt && plan.attemptStatus) {
      const stored = this.attempts.find((a) => a.id === attempt.id)!;
      if (stored.status !== attempt.status) {
        throw new WorkflowConflictError('attempt changed');
      }
      stored.status = plan.attemptStatus;
      if (resolution.kind !== 'NOT_DELIVERED' || resolution.providerReference) {
        stored.providerReference = resolution.providerReference ?? stored.providerReference;
      }
    }
    if (allocation && plan.deliveredAmount > 0) {
      const stored = this.allocations.find((a) => a.id === allocation.id)!;
      expect(stored.status).toBe('RESERVED');
      expect(stored.consumed + plan.deliveredAmount).toBeLessThanOrEqual(stored.amount);
      stored.consumed += plan.deliveredAmount;
      this.sources.get(stored.sourceId)!.reserved -= BigInt(plan.deliveredAmount);
      if (stored.consumed === stored.amount) {
        stored.status = 'CONSUMED';
      }
    }
    const release =
      plan.releaseAllocations === 'ALL'
        ? this.allocations.filter((a) => a.status === 'RESERVED')
        : plan.releaseAllocations === 'CURRENT' && allocation
          ? this.allocations.filter((a) => a.id === allocation.id && a.status === 'RESERVED')
          : [];
    for (const stored of release) {
      const back = stored.amount - stored.consumed;
      stored.released = back;
      stored.status = stored.consumed === 0 ? 'RELEASED' : 'CONSUMED';
      const source = this.sources.get(stored.sourceId)!;
      source.available += BigInt(back);
      source.reserved -= BigInt(back);
    }
    if (allocation) {
      const source = this.sources.get(allocation.sourceId)!;
      if (resolution.kind === 'DELIVERED') {
        source.failures = 0;
        source.health = 'HEALTHY';
      } else if (resolution.error && ['UNAVAILABLE', 'TIMEOUT'].includes(resolution.error)) {
        source.failures += 1;
        source.health = source.failures >= 3 ? 'UNAVAILABLE' : 'DEGRADED';
      }
    }
    for (const t of plan.transitions) {
      if (this.orderStatus !== t.from) {
        throw new WorkflowConflictError('order moved');
      }
      this.transition(t.from, t.to, t.event);
    }
    this.fulfilled += plan.deliveredAmount;
    if (plan.outcome !== 'NEXT_ALLOCATION') {
      this.lease = null;
    }
    for (const source of this.sources.values()) {
      expect(source.available).toBeGreaterThanOrEqual(0n);
      expect(source.reserved).toBeGreaterThanOrEqual(0n);
    }
  }

  async release(_id: string, token: string) {
    if (this.lease?.token === token) {
      this.lease = null;
    }
  }

  private holds(token: string) {
    if (this.lease?.token !== token) {
      throw new WorkflowConflictError('lease lost');
    }
  }

  private transition(from: OrderStatus, to: OrderStatus, event?: string) {
    assertTransition(from, to);
    this.orderStatus = to;
    this.history.push(`${from}>${to}`);
    if (event) {
      this.events.push(event);
    }
  }

  private allocationSnapshot(a: MemoryAllocation): AllocationSnapshot {
    return {
      id: a.id,
      sourceId: a.sourceId,
      provider: this.sources.get(a.sourceId)!.provider,
      amount: a.amount,
      consumedAmount: a.consumed,
    };
  }

  private snapshot(leaseToken: string): FulfillmentWorkflow {
    const latest = this.attempts.at(-1) ?? null;
    return {
      orderId: 'order-1',
      orderStatus: this.orderStatus,
      method: this.method,
      productLine: this.productLine,
      fulfillmentType: this.fulfillmentType,
      recipient: this.recipient,
      fulfillmentOrderId: 'fo-1',
      requestedAmount: this.requested,
      fulfilledAmount: this.fulfilled,
      remainingAmount: this.requested - this.fulfilled,
      retriesUsed: this.history.filter((h) => h.endsWith('>RETRYING')).length,
      lastAttemptNumber: latest?.attemptNumber ?? 0,
      referencesUsed: new Set(this.attempts.map((a) => a.clientReference)).size,
      latestAttempt: latest ? { ...latest } : null,
      openAllocations: this.allocations
        .filter((a) => a.status === 'RESERVED')
        .map((a) => this.allocationSnapshot(a)),
      leaseToken,
    };
  }
}

/** Counts every fulfill call that reached the adapter; can lose the answer of the next call. */
class SpyProvider implements FulfillmentProvider {
  readonly fulfillCalls: FulfillmentRequest[] = [];
  readonly validated: FulfillmentRecipient[] = [];
  /** Simulates a timeout before the request reached the provider: nothing recorded there. */
  dropNextRequest = false;

  constructor(
    readonly inner: MockFulfillmentProvider,
    readonly code = 'mock',
  ) {}

  getBalance() {
    return this.inner.getBalance();
  }
  validateRecipient(recipient: FulfillmentRecipient) {
    this.validated.push(recipient);
    return this.inner.validateRecipient(recipient);
  }
  async fulfill(request: FulfillmentRequest): Promise<FulfillmentResult> {
    this.fulfillCalls.push(request);
    if (this.dropNextRequest) {
      this.dropNextRequest = false;
      return { status: 'UNKNOWN', error: 'TIMEOUT' };
    }
    return this.inner.fulfill(request);
  }
  verify(lookup: Parameters<FulfillmentProvider['verify']>[0]) {
    return this.inner.verify(lookup);
  }
}

function setup(
  scenario: MockScenario = 'SUCCESS',
  balance = 1_000_000n,
  configure: (workflows: InMemoryWorkflows) => void = (w) => w.addSource('source-a', 1_000_000n),
  extraProviders: FulfillmentProvider[] = [],
) {
  const workflows = new InMemoryWorkflows();
  configure(workflows);
  const mock = new MockFulfillmentProvider({ scenario, balance });
  const provider = new SpyProvider(mock);
  const registry = new FulfillmentProviderRegistry([provider, ...extraProviders]);
  const allocations = new FulfillmentAllocationService(workflows, workflows, registry);
  const engine = new FulfillmentEngine(
    workflows,
    new FulfillmentAttemptExecutor(workflows, registry, allocations),
    new FulfillmentAttemptVerifier(registry),
  );
  let runs = 0;
  const run = (overrides: Partial<FulfillmentRun> = {}) => {
    runs += 1;
    return engine.run('order-1', {
      eventId: 'event-1',
      correlationId: 'req-1',
      maxAttempts: 5,
      finalRun: runs >= 5,
      ...overrides,
    });
  };
  return { workflows, mock, provider, run };
}

describe('FulfillmentEngine', () => {
  it('Scenario A: SUCCESS → FULFILLED in one run, one delivery', async () => {
    const { workflows, provider, mock, run } = setup('SUCCESS');
    expect(await run()).toBe('FULFILLED');
    expect(workflows.history).toEqual([
      'QUEUED>PROCESSING',
      'PROCESSING>FULFILLMENT_PENDING',
      'FULFILLMENT_PENDING>FULFILLED',
    ]);
    expect(workflows.events).toEqual(['FULFILLMENT_STARTED', 'FULFILLMENT_COMPLETED']);
    expect(workflows.fulfilled).toBe(1000);
    expect(workflows.attempts).toMatchObject([
      { status: 'SUCCEEDED', clientReference: 'FULFILLMENT-order-1-1' },
    ]);
    expect(provider.fulfillCalls).toHaveLength(1);
    expect(mock.deliveryCount()).toBe(1);
    // A later duplicate delivery of the event finds nothing to do.
    expect(await run()).toBe('NOT_ELIGIBLE');
    expect(provider.fulfillCalls).toHaveLength(1);
  });

  it('sends only reference, recipient and amount', async () => {
    const { provider, run } = setup('SUCCESS');
    await run();
    expect(Object.keys(provider.fulfillCalls[0]!).sort()).toEqual([
      'amount',
      'clientReference',
      'correlationId',
      'recipient',
    ]);
    expect(provider.fulfillCalls[0]!.recipient).toEqual({
      type: 'ROBLOX_USER',
      identifier: 'mock-valid-user',
      externalUserId: null,
    });
  });

  it('Scenario B: RETRYABLE_FAILURE → RETRYING → retry with the same reference → FULFILLED', async () => {
    const { workflows, provider, mock, run } = setup('RETRYABLE_FAILURE');
    expect(await run()).toBe('RETRY_SCHEDULED');
    expect(workflows.orderStatus).toBe('RETRYING');
    mock.setScenario('SUCCESS');
    expect(await run()).toBe('FULFILLED');
    expect(workflows.history).toEqual([
      'QUEUED>PROCESSING',
      'PROCESSING>FAILED',
      'FAILED>RETRYING',
      'RETRYING>PROCESSING',
      'PROCESSING>FULFILLMENT_PENDING',
      'FULFILLMENT_PENDING>FULFILLED',
    ]);
    expect(workflows.attempts.map((a) => [a.attemptNumber, a.status, a.clientReference])).toEqual([
      [1, 'FAILED_RETRYABLE', 'FULFILLMENT-order-1-1'],
      [2, 'SUCCEEDED', 'FULFILLMENT-order-1-1'],
    ]);
    expect(mock.deliveryCount()).toBe(1);
    expect(provider.fulfillCalls).toHaveLength(2);
  });

  it('Scenario C: PENDING → FULFILLMENT_PENDING → verify (still pending) → verify → FULFILLED', async () => {
    const { workflows, provider, mock, run } = setup('PENDING');
    expect(await run()).toBe('AWAITING_VERIFICATION');
    expect(workflows.orderStatus).toBe('FULFILLMENT_PENDING');
    expect(workflows.attempts[0]).toMatchObject({
      status: 'VERIFYING',
      providerReference: 'MOCK-000001',
    });
    expect(await run()).toBe('AWAITING_VERIFICATION');
    mock.settle('MOCK-000001', 'SUCCEEDED');
    expect(await run()).toBe('FULFILLED');
    expect(provider.fulfillCalls).toHaveLength(1);
    expect(workflows.attempts).toHaveLength(1);
  });

  it('Scenario D: SUCCEEDED_BUT_TIMED_OUT → verify → FULFILLED, never a second fulfill', async () => {
    const { workflows, provider, mock, run } = setup('SUCCEEDED_BUT_TIMED_OUT');
    expect(await run()).toBe('AWAITING_VERIFICATION');
    expect(workflows.attempts[0]!.status).toBe('UNKNOWN');
    mock.setScenario('SUCCESS');
    expect(await run()).toBe('FULFILLED');
    expect(provider.fulfillCalls).toHaveLength(1);
    expect(mock.deliveryCount()).toBe(1);
    expect(workflows.fulfilled).toBe(1000);
  });

  it('unknown outcome that verification reports NOT_FOUND is retried with the same reference', async () => {
    const { workflows, provider, run } = setup('SUCCESS');
    provider.dropNextRequest = true;
    expect(await run()).toBe('AWAITING_VERIFICATION');
    expect(await run()).toBe('RETRY_SCHEDULED');
    expect(workflows.attempts[0]!.status).toBe('FAILED_RETRYABLE');
    expect(await run()).toBe('FULFILLED');
    expect(provider.fulfillCalls.map((c) => c.clientReference)).toEqual([
      'FULFILLMENT-order-1-1',
      'FULFILLMENT-order-1-1',
    ]);
  });

  it('a provider that stays unreachable during verification keeps the attempt unknown', async () => {
    const { workflows, mock, provider, run } = setup('SUCCEEDED_BUT_TIMED_OUT');
    await run();
    mock.setScenario('UNAVAILABLE');
    expect(await run()).toBe('AWAITING_VERIFICATION');
    expect(workflows.attempts[0]!.status).toBe('UNKNOWN');
    expect(provider.fulfillCalls).toHaveLength(1);
  });

  it('still unknown on the final run → RECONCILIATION_REQUIRED, no second delivery', async () => {
    const { workflows, mock, provider, run } = setup('SUCCEEDED_BUT_TIMED_OUT');
    await run();
    mock.setScenario('UNAVAILABLE');
    expect(await run({ finalRun: true })).toBe('RECONCILIATION_REQUIRED');
    expect(workflows.orderStatus).toBe('RECONCILIATION_REQUIRED');
    expect(provider.fulfillCalls).toHaveLength(1);
  });

  it('Scenario E: PERMANENT_FAILURE → FAILED_PERMANENTLY, no retry', async () => {
    const { workflows, provider, run } = setup('PERMANENT_FAILURE');
    expect(await run()).toBe('FAILED_PERMANENTLY');
    expect(workflows.history.slice(-2)).toEqual(['PROCESSING>FAILED', 'FAILED>FAILED_PERMANENTLY']);
    expect(workflows.attempts[0]!.status).toBe('FAILED_PERMANENT');
    expect(await run()).toBe('NOT_ELIGIBLE');
    expect(provider.fulfillCalls).toHaveLength(1);
  });

  it('Scenario F: PARTIAL 500 of 1000 → remainder 500 with a new reference → FULFILLED', async () => {
    const { workflows, provider, mock, run } = setup('PARTIAL');
    expect(await run()).toBe('RETRY_SCHEDULED');
    expect(workflows.fulfilled).toBe(500);
    expect(workflows.history).toContain('PROCESSING>PARTIALLY_FULFILLED');
    expect(workflows.orderStatus).toBe('RETRYING');
    mock.setScenario('SUCCESS');
    expect(await run()).toBe('FULFILLED');
    expect(provider.fulfillCalls.map((c) => [c.clientReference, c.amount])).toEqual([
      ['FULFILLMENT-order-1-1', 1000],
      ['FULFILLMENT-order-1-2', 500],
    ]);
    expect(workflows.fulfilled).toBe(1000);
  });

  it('INVALID_RECIPIENT → FAILED_PERMANENTLY before any delivery is attempted', async () => {
    const { workflows, provider, run } = setup('INVALID_RECIPIENT');
    expect(await run()).toBe('FAILED_PERMANENTLY');
    expect(workflows.attempts).toEqual([]);
    expect(provider.fulfillCalls).toEqual([]);
  });

  it('UNAVAILABLE provider is a retryable condition, not a customer failure', async () => {
    const { workflows, provider, mock, run } = setup('UNAVAILABLE');
    expect(await run()).toBe('RETRY_SCHEDULED');
    expect(workflows.orderStatus).toBe('RETRYING');
    expect(provider.fulfillCalls).toEqual([]);
    mock.setScenario('SUCCESS');
    expect(await run()).toBe('FULFILLED');
  });

  it('INSUFFICIENT_BALANCE is checked before sending and retried', async () => {
    const { workflows, provider, mock, run } = setup('SUCCESS', 100n);
    expect(await run()).toBe('RETRY_SCHEDULED');
    expect(provider.fulfillCalls).toEqual([]);
    mock.setBalance(5_000n);
    expect(await run()).toBe('FULFILLED');
    expect(workflows.attempts).toHaveLength(1);
  });

  it('retries are bounded: the 5th run ends FAILED_PERMANENTLY (RETRY_EXHAUSTED), same reference throughout', async () => {
    const { workflows, provider, run } = setup('RETRYABLE_FAILURE');
    const outcomes = [];
    for (let i = 0; i < 5; i += 1) {
      outcomes.push(await run());
    }
    expect(outcomes).toEqual([
      'RETRY_SCHEDULED',
      'RETRY_SCHEDULED',
      'RETRY_SCHEDULED',
      'RETRY_SCHEDULED',
      'FAILED_PERMANENTLY',
    ]);
    expect(workflows.orderStatus).toBe('FAILED_PERMANENTLY');
    expect(new Set(provider.fulfillCalls.map((c) => c.clientReference))).toEqual(
      new Set(['FULFILLMENT-order-1-1']),
    );
    expect(await run()).toBe('NOT_ELIGIBLE');
  });

  it('a failed commit after the provider answered leaves no success; the next run verifies, never re-sends', async () => {
    const { workflows, provider, mock, run } = setup('SUCCESS');
    workflows.failNextApply = true;
    await expect(run()).rejects.toThrow('database unavailable');
    expect(workflows.orderStatus).toBe('PROCESSING');
    expect(workflows.attempts[0]!.status).toBe('EXECUTING');
    expect(workflows.events).not.toContain('FULFILLMENT_COMPLETED');
    expect(workflows.lease).toBeNull();

    expect(await run()).toBe('FULFILLED');
    expect(provider.fulfillCalls).toHaveLength(1);
    expect(mock.deliveryCount()).toBe(1);
  });

  it('a crashed run whose lease has not expired makes others wait (BUSY)', async () => {
    const { workflows, provider, run } = setup('SUCCESS');
    workflows.lease = { token: 'crashed-run', expiresAt: new Date(Date.now() + 60_000) };
    expect(await run()).toBe('BUSY');
    expect(provider.fulfillCalls).toEqual([]);
    workflows.lease = { token: 'crashed-run', expiresAt: new Date(Date.now() - 1) };
    expect(await run()).toBe('FULFILLED');
  });

  it('10 concurrent runs for one order: one workflow, one delivery', async () => {
    const { workflows, provider, mock, run } = setup('SUCCESS');
    const outcomes = await Promise.all(Array.from({ length: 10 }, () => run({ finalRun: false })));
    expect(outcomes.filter((o) => o === 'FULFILLED')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'BUSY')).toHaveLength(9);
    expect(provider.fulfillCalls).toHaveLength(1);
    expect(mock.deliveryCount()).toBe(1);
    expect(workflows.history.filter((h) => h === 'QUEUED>PROCESSING')).toHaveLength(1);
  });

  it('leaves orders outside the automatic path alone', async () => {
    for (const status of ['PAID', 'CANCELLED', 'REFUND_PENDING', 'FULFILLED'] as const) {
      const { workflows, provider, run } = setup('SUCCESS');
      workflows.orderStatus = status;
      expect(await run()).toBe('NOT_ELIGIBLE');
      expect(provider.fulfillCalls).toEqual([]);
    }
    const gamepass = setup('SUCCESS');
    gamepass.workflows.method = 'GAMEPASS';
    expect(await gamepass.run()).toBe('NOT_ELIGIBLE');
  });
});

describe('FulfillmentEngine with inventory (Phase 10)', () => {
  const sourceOf = (w: InMemoryWorkflows, id = 'source-a') => w.sources.get(id)!;

  it('reserves once, consumes on success and leaves nothing reserved', async () => {
    const { workflows, run } = setup('SUCCESS', 1_000_000n, (w) => w.addSource('source-a', 5_000n));
    expect(await run()).toBe('FULFILLED');
    expect(workflows.allocations).toMatchObject([
      { amount: 1000, consumed: 1000, status: 'CONSUMED' },
    ]);
    expect(sourceOf(workflows)).toMatchObject({ available: 4_000n, reserved: 0n });
    expect(workflows.attempts[0]!.allocationId).toBe('allocation-1');
  });

  it('a retry after a failure releases first, then reserves again: never two reservations', async () => {
    const { workflows, mock, run } = setup('RETRYABLE_FAILURE', 1_000_000n, (w) =>
      w.addSource('source-a', 5_000n),
    );
    expect(await run()).toBe('RETRY_SCHEDULED');
    expect(workflows.allocations).toMatchObject([{ status: 'RELEASED', released: 1000 }]);
    expect(sourceOf(workflows)).toMatchObject({ available: 5_000n, reserved: 0n });
    mock.setScenario('SUCCESS');
    expect(await run()).toBe('FULFILLED');
    expect(workflows.allocations.filter((a) => a.status === 'RESERVED')).toHaveLength(0);
    expect(sourceOf(workflows)).toMatchObject({ available: 4_000n, reserved: 0n });
  });

  it('an unknown outcome keeps its reservation; verification consumes it without a new one', async () => {
    const { workflows, mock, provider, run } = setup('SUCCEEDED_BUT_TIMED_OUT', 1_000_000n, (w) =>
      w.addSource('source-a', 5_000n),
    );
    expect(await run()).toBe('AWAITING_VERIFICATION');
    expect(sourceOf(workflows)).toMatchObject({ available: 4_000n, reserved: 1_000n });
    mock.setScenario('SUCCESS');
    expect(await run()).toBe('FULFILLED');
    expect(workflows.allocations).toHaveLength(1);
    expect(sourceOf(workflows)).toMatchObject({ available: 4_000n, reserved: 0n });
    expect(provider.fulfillCalls).toHaveLength(1);
  });

  it('a partial delivery keeps the remainder reserved on the same allocation', async () => {
    const { workflows, mock, provider, run } = setup('PARTIAL', 1_000_000n, (w) =>
      w.addSource('source-a', 5_000n),
    );
    expect(await run()).toBe('RETRY_SCHEDULED');
    expect(workflows.allocations).toMatchObject([{ consumed: 500, status: 'RESERVED' }]);
    expect(sourceOf(workflows)).toMatchObject({ available: 4_000n, reserved: 500n });
    mock.setScenario('SUCCESS');
    expect(await run()).toBe('FULFILLED');
    expect(workflows.allocations).toMatchObject([{ consumed: 1000, status: 'CONSUMED' }]);
    expect(provider.fulfillCalls.map((c) => [c.clientReference, c.amount])).toEqual([
      ['FULFILLMENT-order-1-1', 1000],
      ['FULFILLMENT-order-1-2', 500],
    ]);
    expect(workflows.attempts.every((a) => a.allocationId === 'allocation-1')).toBe(true);
  });

  it('a final failure releases what is left; delivered Robux stay consumed', async () => {
    const { workflows, mock, run } = setup('PARTIAL', 1_000_000n, (w) =>
      w.addSource('source-a', 5_000n),
    );
    await run();
    mock.setScenario('PERMANENT_FAILURE');
    expect(await run()).toBe('FAILED_PERMANENTLY');
    expect(workflows.allocations).toMatchObject([
      { consumed: 500, released: 500, status: 'CONSUMED' },
    ]);
    expect(sourceOf(workflows)).toMatchObject({ available: 4_500n, reserved: 0n });
  });

  it('splits across the fewest sources and delivers every allocation in one run', async () => {
    const { workflows, provider, run } = setup('SUCCESS', 1_000_000n, (w) => {
      w.addSource('source-a', 600n);
      w.addSource('source-b', 700n);
      w.addSource('source-c', 300n);
    });
    expect(await run()).toBe('FULFILLED');
    // Two sources are needed; B+C covers exactly (no surplus) and beats A+B (300 surplus).
    expect(workflows.allocations.map((a) => [a.sourceId, a.amount, a.status])).toEqual([
      ['source-b', 700, 'CONSUMED'],
      ['source-c', 300, 'CONSUMED'],
    ]);
    expect(sourceOf(workflows, 'source-a')).toMatchObject({ available: 600n, reserved: 0n });
    expect(provider.fulfillCalls.map((c) => c.amount)).toEqual([700, 300]);
    expect(new Set(provider.fulfillCalls.map((c) => c.clientReference)).size).toBe(2);
    expect(workflows.history).toEqual([
      'QUEUED>PROCESSING',
      'PROCESSING>FULFILLMENT_PENDING',
      'FULFILLMENT_PENDING>FULFILLED',
    ]);
    expect(workflows.lease).toBeNull();
  });

  it('no eligible source is an explicit, retryable outcome; nothing is invented', async () => {
    const { workflows, provider, run } = setup('SUCCESS', 1_000_000n, (w) =>
      w.addSource('source-a', 5_000n, { status: 'DISABLED' }),
    );
    expect(await run()).toBe('RETRY_SCHEDULED');
    expect(workflows.allocations).toEqual([]);
    expect(provider.fulfillCalls).toEqual([]);
    sourceOf(workflows).status = 'ACTIVE';
    expect(await run()).toBe('FULFILLED');
  });

  it('the kill switch stops new allocations but lets an open one finish', async () => {
    const { workflows, mock, run } = setup('SUCCEEDED_BUT_TIMED_OUT', 1_000_000n, (w) =>
      w.addSource('source-a', 5_000n),
    );
    await run();
    sourceOf(workflows).status = 'DISABLED';
    mock.setScenario('SUCCESS');
    expect(await run()).toBe('FULFILLED');
    expect(sourceOf(workflows)).toMatchObject({ available: 4_000n, reserved: 0n });
  });

  it('repeated provider outages take a source out of routing; another source takes over', async () => {
    const backup = new SpyProvider(
      new MockFulfillmentProvider({ scenario: 'SUCCESS', balance: 1_000_000n }),
      'mock-b',
    );
    const { workflows, run } = setup(
      'UNAVAILABLE',
      1_000_000n,
      (w) => {
        w.addSource('source-a', 5_000n, { priority: 1 });
        w.addSource('source-b', 9_000n, { provider: 'mock-b', priority: 2 });
      },
      [backup],
    );
    // A is the best fit, fails three times, then routing skips it.
    for (let i = 0; i < 3; i += 1) {
      expect(await run({ finalRun: false })).toBe('RETRY_SCHEDULED');
    }
    expect(sourceOf(workflows)).toMatchObject({
      health: 'UNAVAILABLE',
      reserved: 0n,
      available: 5_000n,
    });
    expect(await run({ finalRun: false })).toBe('FULFILLED');
    expect(backup.fulfillCalls).toHaveLength(1);
    expect(sourceOf(workflows, 'source-b')).toMatchObject({ available: 8_000n, reserved: 0n });
  });
});

describe('FulfillmentEngine across fulfillment types (Phase 11)', () => {
  it('RECIPIENT_FULFILLMENT (Telegram Stars): routes Stars sources only and delivers to the Telegram user', async () => {
    const { workflows, provider, run } = setup('SUCCESS', 1_000_000n, (w) => {
      w.addSource('robux-source', 9_000n);
      w.addSource('stars-source', 5_000n, { productLine: 'TELEGRAM_STARS' });
      w.productLine = 'TELEGRAM_STARS';
      w.fulfillmentType = 'RECIPIENT_FULFILLMENT';
      w.recipient = { type: 'TELEGRAM_USER', identifier: 'durov', externalUserId: null };
    });
    expect(await run()).toBe('FULFILLED');
    expect(workflows.allocations.map((a) => a.sourceId)).toEqual(['stars-source']);
    expect(workflows.sources.get('robux-source')).toMatchObject({
      available: 9_000n,
      reserved: 0n,
    });
    expect(provider.validated).toEqual([
      { type: 'TELEGRAM_USER', identifier: 'durov', externalUserId: null },
    ]);
    expect(provider.fulfillCalls[0]!.recipient).toMatchObject({
      type: 'TELEGRAM_USER',
      identifier: 'durov',
    });
  });

  it('DIGITAL_DELIVERY (Telegram account): inventory-backed, no recipient, nothing to validate', async () => {
    const { workflows, provider, run } = setup('SUCCESS', 1_000_000n, (w) => {
      w.addSource('accounts', 3n, { productLine: 'TELEGRAM_ACCOUNT' });
      w.productLine = 'TELEGRAM_ACCOUNT';
      w.fulfillmentType = 'DIGITAL_DELIVERY';
      w.recipient = null;
      w.requested = 1;
    });
    expect(await run()).toBe('FULFILLED');
    // One item reserved and consumed from the account stock: AVAILABLE → RESERVED → SOLD.
    expect(workflows.allocations).toMatchObject([
      { sourceId: 'accounts', amount: 1, status: 'CONSUMED' },
    ]);
    expect(workflows.sources.get('accounts')).toMatchObject({ available: 2n, reserved: 0n });
    expect(provider.validated).toEqual([]);
    expect(provider.fulfillCalls).toMatchObject([{ recipient: null, amount: 1 }]);
  });

  it('a type without matching stock waits as NO_ELIGIBLE_SOURCE instead of using another line', async () => {
    const { workflows, provider, run } = setup('SUCCESS', 1_000_000n, (w) => {
      w.addSource('robux-source', 9_000n);
      w.productLine = 'TELEGRAM_PREMIUM';
      w.fulfillmentType = 'RECIPIENT_FULFILLMENT';
      w.recipient = { type: 'TELEGRAM_USER', identifier: 'durov', externalUserId: null };
    });
    expect(await run()).toBe('RETRY_SCHEDULED');
    expect(workflows.allocations).toEqual([]);
    expect(provider.fulfillCalls).toEqual([]);
  });

  it('a snapshot that does not fit its type fails before anything is reserved', async () => {
    const { workflows, provider, run } = setup('SUCCESS', 1_000_000n, (w) => {
      w.addSource('accounts', 3n, { productLine: 'TELEGRAM_ACCOUNT' });
      w.productLine = 'TELEGRAM_ACCOUNT';
      w.fulfillmentType = 'DIGITAL_DELIVERY';
      w.recipient = { type: 'TELEGRAM_USER', identifier: 'someone', externalUserId: null };
    });
    expect(await run()).toBe('FAILED_PERMANENTLY');
    expect(workflows.allocations).toEqual([]);
    expect(provider.fulfillCalls).toEqual([]);
  });
});
