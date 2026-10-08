import type { MOCK_SCENARIO_NAMES } from '../../../../../config/fulfillment-config';

/**
 * What the mock does with the next new client reference. Chosen explicitly (configuration or a
 * test), never at random, so every run is reproducible.
 */
export const MockScenario = {
  SUCCESS: 'SUCCESS',
  PENDING: 'PENDING',
  PARTIAL: 'PARTIAL',
  RETRYABLE_FAILURE: 'RETRYABLE_FAILURE',
  PERMANENT_FAILURE: 'PERMANENT_FAILURE',
  /** Delivers, then reports a timeout: the case verify-before-retry exists for. */
  SUCCEEDED_BUT_TIMED_OUT: 'SUCCEEDED_BUT_TIMED_OUT',
  INVALID_RECIPIENT: 'INVALID_RECIPIENT',
  UNAVAILABLE: 'UNAVAILABLE',
} as const satisfies Record<string, (typeof MOCK_SCENARIO_NAMES)[number]>;

export type MockScenario = (typeof MockScenario)[keyof typeof MockScenario];

export const MOCK_SCENARIOS = Object.values(MockScenario);

/**
 * Fixed test recipients that behave the same under every scenario. Any other username is treated
 * as valid: the mock knows nothing about real Roblox accounts and must not pretend to.
 */
export const MockRecipient = {
  VALID: 'mock-valid-user',
  INVALID: 'mock-invalid-user',
  UNAVAILABLE: 'mock-unavailable-user',
} as const;
