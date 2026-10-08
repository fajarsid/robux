/**
 * Which fulfillment provider adapters this process may use. `none` (the default) registers no
 * provider at all. `mock` is the deterministic simulator for development and tests. No authorized
 * provider exists yet (D-01): any other value fails startup instead of falling back to the mock.
 */
export type FulfillmentProviderName = 'mock' | 'none';

export const MOCK_SCENARIO_NAMES = [
  'SUCCESS',
  'PENDING',
  'PARTIAL',
  'RETRYABLE_FAILURE',
  'PERMANENT_FAILURE',
  'SUCCEEDED_BUT_TIMED_OUT',
  'INVALID_RECIPIENT',
  'UNAVAILABLE',
] as const;

export interface FulfillmentConfig {
  provider: FulfillmentProviderName;
  mock: { balance: bigint; scenario: (typeof MOCK_SCENARIO_NAMES)[number] } | null;
}

const DEFAULT_MOCK_BALANCE = 1_000_000n;

export function loadFulfillmentConfig(env: NodeJS.ProcessEnv): FulfillmentConfig {
  const provider = env.FULFILLMENT_PROVIDER ?? 'none';
  if (provider === 'none') {
    return { provider, mock: null };
  }
  if (provider !== 'mock') {
    throw new Error('Invalid configuration: FULFILLMENT_PROVIDER must be mock or none');
  }
  // Production safety gate: a paid customer order must never be "fulfilled" by the simulator.
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'Invalid configuration: FULFILLMENT_PROVIDER=mock is not allowed in production',
    );
  }

  const balanceText = env.MOCK_FULFILLMENT_BALANCE ?? String(DEFAULT_MOCK_BALANCE);
  if (!/^\d{1,15}$/.test(balanceText)) {
    throw new Error(
      'Invalid configuration: MOCK_FULFILLMENT_BALANCE must be a whole number of Robux',
    );
  }
  const scenario = env.MOCK_FULFILLMENT_SCENARIO ?? 'SUCCESS';
  if (!(MOCK_SCENARIO_NAMES as readonly string[]).includes(scenario)) {
    throw new Error(
      `Invalid configuration: MOCK_FULFILLMENT_SCENARIO must be one of ${MOCK_SCENARIO_NAMES.join(', ')}`,
    );
  }
  return {
    provider,
    mock: {
      balance: BigInt(balanceText),
      scenario: scenario as (typeof MOCK_SCENARIO_NAMES)[number],
    },
  };
}
