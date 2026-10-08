import type { SourceHealth, SourceStatus } from '../../../generated/prisma/enums';

/** Identifier stored on every allocation, so a later algorithm never reinterprets old decisions. */
export const ROUTING_STRATEGY = 'SMART_V1';

export interface SourceCandidate {
  id: string;
  name: string;
  provider: string;
  status: SourceStatus;
  health: SourceHealth;
  available: bigint;
  /** Lower number = preferred. A tie-breaker only. */
  priority: number;
  /** Per-Robux cost as a decimal string, or null when not configured. */
  costPerUnit: string | null;
  /** This process has an adapter for the source's provider (FulfillmentProviderRegistry). */
  providerConfigured: boolean;
}

export type ExclusionReason = 'DISABLED' | 'UNHEALTHY' | 'PROVIDER_NOT_CONFIGURED' | 'NO_BALANCE';

export interface PlannedAllocation {
  sourceId: string;
  amount: number;
}

/** Compact explanation stored with the allocations (ADR-007). */
export interface RoutingDecisionRecord {
  strategy: typeof ROUTING_STRATEGY;
  amount: number;
  sourceCount: number;
  /** Σ chosen balances − amount: the balance the plan leaves on the chosen sources. */
  surplus: string;
  candidates: {
    sourceId: string;
    available: string;
    priority: number;
    excluded?: ExclusionReason;
  }[];
  reason: string;
}

export type RoutingDecision =
  | { kind: 'PLANNED'; allocations: PlannedAllocation[]; record: RoutingDecisionRecord }
  | {
      kind: 'NO_ELIGIBLE_SOURCE';
      /** No eligible source at all, or all of them together hold less than the amount. */
      reason: 'NO_ELIGIBLE_SOURCE' | 'INSUFFICIENT_INVENTORY';
      record: RoutingDecisionRecord;
    };

/** Combinations above this are not enumerated; a deterministic best-fit greedy plan is used. */
const MAX_COMBINATIONS = 5_000;

const HEALTHY: readonly SourceHealth[] = ['HEALTHY', 'DEGRADED'];

function exclusionOf(source: SourceCandidate): ExclusionReason | undefined {
  if (source.status !== 'ACTIVE') {
    return 'DISABLED';
  }
  if (!HEALTHY.includes(source.health)) {
    return 'UNHEALTHY';
  }
  if (!source.providerConfigured) {
    return 'PROVIDER_NOT_CONFIGURED';
  }
  if (source.available <= 0n) {
    return 'NO_BALANCE';
  }
  return undefined;
}

/**
 * D-08 (ARCHITECTURE.md §6.5). Deterministic and pure: the same sources and amount always give the
 * same plan. Objectives, in order:
 *   1. only ACTIVE (kill switch off), HEALTHY/DEGRADED sources whose provider is configured;
 *   2. only sources with available balance;
 *   3. a plan that covers the whole amount (never a partial plan);
 *   4. the fewest sources;
 *   5. the least surplus (Σ chosen balances − amount, i.e. best fit: large balances stay whole);
 *   6. tie-breakers: priority (ascending, compared as a sorted list), then cost per unit
 *      (ascending, unconfigured last), then source id.
 * Inside a multi-source plan the smaller balances are drained and the largest source supplies the
 * rest, which leaves the fewest sources holding small remainders.
 */
export function planRouting(sources: readonly SourceCandidate[], amount: number): RoutingDecision {
  const candidates = [...sources]
    .sort((a, b) => compareIds(a.id, b.id))
    .map((s) => ({
      sourceId: s.id,
      available: s.available.toString(),
      priority: s.priority,
      ...(exclusionOf(s) ? { excluded: exclusionOf(s) } : {}),
    }));
  const eligible = sources.filter((s) => !exclusionOf(s));
  const record = (sourceCount: number, surplus: bigint, reason: string): RoutingDecisionRecord => ({
    strategy: ROUTING_STRATEGY,
    amount,
    sourceCount,
    surplus: surplus.toString(),
    candidates,
    reason,
  });

  if (eligible.length === 0) {
    return {
      kind: 'NO_ELIGIBLE_SOURCE',
      reason: 'NO_ELIGIBLE_SOURCE',
      record: record(0, 0n, 'No active, healthy source with balance'),
    };
  }
  const need = BigInt(amount);
  const byBalance = [...eligible].sort(
    (a, b) => compareBig(b.available, a.available) || compareIds(a.id, b.id),
  );
  let k = 0;
  let covered = 0n;
  while (k < byBalance.length && covered < need) {
    covered += byBalance[k]!.available;
    k += 1;
  }
  if (covered < need) {
    return {
      kind: 'NO_ELIGIBLE_SOURCE',
      reason: 'INSUFFICIENT_INVENTORY',
      record: record(0, 0n, `Eligible sources hold ${covered} of ${need}`),
    };
  }

  const best =
    combinationCount(eligible.length, k) <= MAX_COMBINATIONS
      ? bestCombination(eligible, k, need)
      : greedyBestFit(byBalance, k, need);
  const allocations = splitAcross(best, need);
  const surplus = best.reduce((sum, s) => sum + s.available, 0n) - need;
  return {
    kind: 'PLANNED',
    allocations,
    record: record(
      best.length,
      surplus,
      k === 1
        ? 'Single source covers the amount; smallest surplus, then priority'
        : `No single source covers the amount; fewest sources (${k}), smallest surplus, then priority`,
    ),
  };
}

function bestCombination(
  eligible: readonly SourceCandidate[],
  k: number,
  need: bigint,
): SourceCandidate[] {
  let best: SourceCandidate[] | null = null;
  const sorted = [...eligible].sort((a, b) => compareIds(a.id, b.id));
  const visit = (start: number, chosen: SourceCandidate[], sum: bigint) => {
    if (chosen.length === k) {
      if (sum >= need && (!best || comparePlans(chosen, best, need) < 0)) {
        best = [...chosen];
      }
      return;
    }
    for (let i = start; i <= sorted.length - (k - chosen.length); i += 1) {
      chosen.push(sorted[i]!);
      visit(i + 1, chosen, sum + sorted[i]!.available);
      chosen.pop();
    }
  };
  visit(0, [], 0n);
  return best!;
}

/** Largest balances first until covered, then each pick swapped for the tightest source that still covers. */
function greedyBestFit(
  byBalance: readonly SourceCandidate[],
  k: number,
  need: bigint,
): SourceCandidate[] {
  const chosen = byBalance.slice(0, k);
  for (let i = chosen.length - 1; i >= 0; i -= 1) {
    const others = chosen.reduce((sum, s, j) => (j === i ? sum : sum + s.available), 0n);
    const replacement = byBalance
      .filter((s) => !chosen.includes(s) || s === chosen[i])
      .filter((s) => others + s.available >= need)
      .sort((a, b) => compareBig(a.available, b.available) || compareTieBreak([a], [b]))[0];
    if (replacement) {
      chosen[i] = replacement;
    }
  }
  return chosen;
}

function comparePlans(a: SourceCandidate[], b: SourceCandidate[], need: bigint): number {
  const surplus = (plan: SourceCandidate[]) =>
    plan.reduce((sum, s) => sum + s.available, 0n) - need;
  return compareBig(surplus(a), surplus(b)) || compareTieBreak(a, b);
}

function compareTieBreak(a: SourceCandidate[], b: SourceCandidate[]): number {
  return (
    compareLists(
      a.map((s) => s.priority).sort((x, y) => x - y),
      b.map((s) => s.priority).sort((x, y) => x - y),
      (x, y) => x - y,
    ) ||
    compareLists(costs(a), costs(b), (x, y) => x - y) ||
    compareLists(
      a.map((s) => s.id).sort(compareIds),
      b.map((s) => s.id).sort(compareIds),
      compareIds,
    )
  );
}

/** Unconfigured cost sorts after every configured one. */
function costs(plan: SourceCandidate[]): number[] {
  return plan
    .map((s) => (s.costPerUnit === null ? Number.POSITIVE_INFINITY : Number(s.costPerUnit)))
    .sort((x, y) => x - y);
}

/** Drain the smaller sources, take the rest from the largest. Ties: by id, for determinism. */
function splitAcross(plan: SourceCandidate[], need: bigint): PlannedAllocation[] {
  const ordered = [...plan].sort(
    (a, b) => compareBig(a.available, b.available) || compareIds(a.id, b.id),
  );
  const allocations: PlannedAllocation[] = [];
  let left = need;
  for (let i = 0; i < ordered.length; i += 1) {
    const source = ordered[i]!;
    const isLargest = i === ordered.length - 1;
    const take = isLargest ? left : source.available < left ? source.available : left;
    if (take > 0n) {
      allocations.push({ sourceId: source.id, amount: Number(take) });
      left -= take;
    }
  }
  return allocations.sort((a, b) => compareIds(a.sourceId, b.sourceId));
}

function combinationCount(n: number, k: number): number {
  let result = 1;
  for (let i = 1; i <= k; i += 1) {
    result = (result * (n - k + i)) / i;
    if (result > MAX_COMBINATIONS) {
      return result;
    }
  }
  return result;
}

function compareLists<T>(a: T[], b: T[], compare: (x: T, y: T) => number): number {
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    const c = compare(a[i]!, b[i]!);
    if (c !== 0) {
      return c;
    }
  }
  return a.length - b.length;
}

function compareBig(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
