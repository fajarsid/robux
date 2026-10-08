import { planRouting, ROUTING_STRATEGY, type SourceCandidate } from './routing';

let counter = 0;
function source(name: string, available: number, overrides: Partial<SourceCandidate> = {}) {
  counter += 1;
  return {
    id: `0000000${counter}-${name}`,
    name,
    provider: 'mock',
    status: 'ACTIVE',
    health: 'HEALTHY',
    available: BigInt(available),
    priority: 100,
    costPerUnit: null,
    providerConfigured: true,
    ...overrides,
  } satisfies SourceCandidate;
}

/** The plan as `name=amount`, so assertions read like the D-08 table. */
function plan(sources: SourceCandidate[], amount: number) {
  const decision = planRouting(sources, amount);
  if (decision.kind !== 'PLANNED') {
    return decision.reason;
  }
  const names = new Map(sources.map((s) => [s.id, s.name]));
  return decision.allocations
    .map((a) => `${names.get(a.sourceId)}=${a.amount}`)
    .sort()
    .join(' ');
}

describe('planRouting (D-08, SMART_V1)', () => {
  it('1. one source fully satisfies', () => {
    expect(plan([source('A', 5000)], 1000)).toBe('A=1000');
  });

  it('2. several sources can: the tightest fit wins, large balances stay whole', () => {
    expect(plan([source('A', 1500), source('B', 5000), source('C', 10000)], 1000)).toBe('A=1000');
    expect(plan([source('C', 1000), source('D', 5000)], 1000)).toBe('C=1000');
  });

  it('prefers full satisfaction and fit over priority (prompt §15 example)', () => {
    const sources = [
      source('A', 1200, { priority: 10 }),
      source('B', 1000, { priority: 5 }),
      source('C', 700, { priority: 1 }),
    ];
    expect(plan(sources, 1000)).toBe('B=1000');
    // C has the best priority but cannot cover the order alone, so it is not split in.
    expect(
      plan([source('A', 1200, { priority: 10 }), source('C', 700, { priority: 1 })], 1000),
    ).toBe('A=1000');
  });

  it('3/4. no single source covers: fewest sources, smaller drained, largest supplies the rest', () => {
    expect(plan([source('A', 1000), source('B', 700)], 1500)).toBe('A=800 B=700');
    expect(plan([source('A', 300), source('B', 700)], 1000)).toBe('A=300 B=700');
  });

  it('minimises source count before surplus', () => {
    // A+B+C (3 sources, surplus 0) loses to D+E (2 sources, surplus 100).
    const sources = [
      source('A', 350),
      source('B', 350),
      source('C', 300),
      source('D', 600),
      source('E', 500),
    ];
    expect(plan(sources, 1000)).toBe('D=500 E=500');
  });

  it('12. among equal source counts, the least surplus (fragmentation) wins', () => {
    const sources = [source('A', 600), source('B', 700), source('C', 300)];
    expect(plan(sources, 1000)).toBe('B=700 C=300');
  });

  it('5/6. disabled and unavailable sources never receive an allocation', () => {
    const sources = [
      source('A', 5000, { status: 'DISABLED' }),
      source('B', 5000, { health: 'UNAVAILABLE' }),
      source('C', 5000, { health: 'UNKNOWN' }),
      source('D', 5000, { providerConfigured: false }),
      source('E', 1000, { health: 'DEGRADED' }),
    ];
    expect(plan(sources, 1000)).toBe('E=1000');
    const decision = planRouting(sources, 1000);
    expect(decision.record.candidates.map((c) => c.excluded ?? 'eligible')).toEqual([
      'DISABLED',
      'UNHEALTHY',
      'UNHEALTHY',
      'PROVIDER_NOT_CONFIGURED',
      'eligible',
    ]);
  });

  it('7. zero balance is not eligible', () => {
    expect(plan([source('A', 0)], 1)).toBe('NO_ELIGIBLE_SOURCE');
  });

  it('8. insufficient balance overall is an explicit outcome, never a partial plan', () => {
    expect(plan([source('A', 400), source('B', 500)], 1000)).toBe('INSUFFICIENT_INVENTORY');
    expect(plan([], 1000)).toBe('NO_ELIGIBLE_SOURCE');
  });

  it('9. exact balance is enough', () => {
    expect(plan([source('A', 1000)], 1000)).toBe('A=1000');
  });

  it('10/11. equal candidates: priority (lower first), then cost, then id', () => {
    expect(
      plan([source('A', 2000, { priority: 2 }), source('B', 2000, { priority: 1 })], 1000),
    ).toBe('B=1000');
    expect(
      plan(
        [
          source('A', 2000, { costPerUnit: '96.0000' }),
          source('B', 2000, { costPerUnit: '95.5000' }),
          source('C', 2000, { costPerUnit: null }),
        ],
        1000,
      ),
    ).toBe('B=1000');
    const first = source('X', 2000);
    const second = source('Y', 2000);
    expect(plan([second, first], 1000)).toBe('X=1000');
  });

  it('priority among multi-source plans compares the sorted priority lists (D-08 table)', () => {
    const sources = [
      source('A', 600, { priority: 1 }),
      source('B', 600, { priority: 2 }),
      source('C', 600, { priority: 3 }),
    ];
    expect(plan(sources, 1000)).toBe('A=600 B=400');
  });

  it('is deterministic: input order never changes the plan', () => {
    const sources = [source('A', 600), source('B', 700), source('C', 300), source('D', 1200)];
    const expected = plan(sources, 1000);
    for (let i = 0; i < 10; i += 1) {
      const shuffled = [...sources].sort(
        (x, y) => ((x.name.charCodeAt(0) * (i + 3)) % 7) - ((y.name.charCodeAt(0) * (i + 3)) % 7),
      );
      expect(plan(shuffled, 1000)).toBe(expected);
    }
  });

  it('records why: strategy, candidates, source count and surplus', () => {
    const sources = [source('A', 1200, { priority: 10 }), source('B', 1000, { priority: 5 })];
    const decision = planRouting(sources, 1000);
    expect(decision.kind).toBe('PLANNED');
    expect(decision.record).toMatchObject({
      strategy: ROUTING_STRATEGY,
      amount: 1000,
      sourceCount: 1,
      surplus: '0',
    });
    expect(decision.record.candidates).toHaveLength(2);
  });

  it('stays exact and covering for many sources (greedy fallback beyond the enumeration cap)', () => {
    const many = Array.from({ length: 40 }, (_, i) => source(`S${i}`, 100 + i));
    const decision = planRouting(many, 1500);
    expect(decision.kind).toBe('PLANNED');
    if (decision.kind === 'PLANNED') {
      expect(decision.allocations.reduce((sum, a) => sum + a.amount, 0)).toBe(1500);
      const byId = new Map(many.map((s) => [s.id, s.available]));
      for (const allocation of decision.allocations) {
        expect(BigInt(allocation.amount)).toBeLessThanOrEqual(byId.get(allocation.sourceId)!);
        expect(allocation.amount).toBeGreaterThan(0);
      }
      expect(decision.record.sourceCount).toBe(decision.allocations.length);
    }
  });

  it('property: every plan covers exactly, never exceeds a balance, never uses excluded sources', () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    for (let round = 0; round < 300; round += 1) {
      const sources = Array.from({ length: 1 + Math.floor(random() * 7) }, (_, i) =>
        source(`R${round}-${i}`, Math.floor(random() * 3000), {
          priority: Math.floor(random() * 5),
          status: random() < 0.15 ? 'DISABLED' : 'ACTIVE',
          health: random() < 0.15 ? 'UNAVAILABLE' : 'HEALTHY',
        }),
      );
      const amount = 1 + Math.floor(random() * 5000);
      const decision = planRouting(sources, amount);
      const eligible = sources.filter(
        (s) => s.status === 'ACTIVE' && s.health === 'HEALTHY' && s.available > 0n,
      );
      const total = eligible.reduce((sum, s) => sum + s.available, 0n);
      if (decision.kind === 'NO_ELIGIBLE_SOURCE') {
        expect(total).toBeLessThan(BigInt(amount));
        continue;
      }
      expect(decision.allocations.reduce((sum, a) => sum + a.amount, 0)).toBe(amount);
      for (const allocation of decision.allocations) {
        const chosen = eligible.find((s) => s.id === allocation.sourceId);
        expect(chosen).toBeDefined();
        expect(BigInt(allocation.amount)).toBeLessThanOrEqual(chosen!.available);
      }
      // Fewest sources: no plan with fewer sources exists.
      const sorted = eligible.map((s) => s.available).sort((a, b) => (a > b ? -1 : 1));
      let k = 0;
      let covered = 0n;
      while (covered < BigInt(amount)) {
        covered += sorted[k]!;
        k += 1;
      }
      expect(decision.allocations.length).toBe(k);
    }
  });
});
