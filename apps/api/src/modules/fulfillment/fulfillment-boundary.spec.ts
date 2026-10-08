import { Logger } from '@nestjs/common';
import { MOCK_SCENARIO_NAMES, loadFulfillmentConfig } from '../../config/fulfillment-config';
import {
  FulfillmentProviderRegistry,
  ProviderNotConfiguredError,
} from './application/fulfillment-provider.registry';
import { ObservedFulfillmentProvider } from './application/observed-fulfillment.provider';
import type { FulfillmentProvider } from './domain/fulfillment-provider';
import { configuredFulfillmentProviders } from './infrastructure/configured-providers';
import { MockFulfillmentProvider } from './infrastructure/providers/mock/mock-fulfillment.provider';
import { MOCK_SCENARIOS } from './infrastructure/providers/mock/mock-scenario';

describe('fulfillment configuration', () => {
  it('registers no provider unless one is asked for', () => {
    const config = loadFulfillmentConfig({});
    expect(config).toEqual({ provider: 'none', mock: null });
    expect(configuredFulfillmentProviders(config)).toEqual([]);
  });

  it('enables the mock explicitly, with configurable balance and scenario', () => {
    const config = loadFulfillmentConfig({
      FULFILLMENT_PROVIDER: 'mock',
      MOCK_FULFILLMENT_BALANCE: '500',
      MOCK_FULFILLMENT_SCENARIO: 'PENDING',
    });
    expect(config).toEqual({ provider: 'mock', mock: { balance: 500n, scenario: 'PENDING' } });
    const [provider] = configuredFulfillmentProviders(config);
    expect(provider).toBeInstanceOf(MockFulfillmentProvider);
  });

  it('refuses the mock in production, so a paid order can never be "fulfilled" by it', () => {
    expect(() =>
      loadFulfillmentConfig({ NODE_ENV: 'production', FULFILLMENT_PROVIDER: 'mock' }),
    ).toThrow('FULFILLMENT_PROVIDER=mock is not allowed in production');
    expect(loadFulfillmentConfig({ NODE_ENV: 'production' }).provider).toBe('none');
  });

  it('fails on a provider that does not exist instead of falling back to the mock', () => {
    expect(() => loadFulfillmentConfig({ FULFILLMENT_PROVIDER: 'roblox-direct' })).toThrow(
      'FULFILLMENT_PROVIDER must be mock or none',
    );
  });

  it.each([
    ['MOCK_FULFILLMENT_BALANCE', '-1'],
    ['MOCK_FULFILLMENT_BALANCE', '1.5'],
    ['MOCK_FULFILLMENT_SCENARIO', 'RANDOM'],
  ])('rejects %s=%s', (name, value) => {
    expect(() => loadFulfillmentConfig({ FULFILLMENT_PROVIDER: 'mock', [name]: value })).toThrow(
      'Invalid configuration',
    );
  });

  it('offers exactly the scenarios the mock implements', () => {
    expect([...MOCK_SCENARIOS].sort()).toEqual([...MOCK_SCENARIO_NAMES].sort());
  });
});

describe('FulfillmentProviderRegistry', () => {
  const provider = new MockFulfillmentProvider({ scenario: 'SUCCESS', balance: 1n });

  it('hands out providers by source provider code only', () => {
    const registry = new FulfillmentProviderRegistry([provider]);
    expect(registry.get('mock')).toBe(provider);
    expect(registry.codes()).toEqual(['mock']);
  });

  it('refuses an unknown code rather than substituting another provider', () => {
    const registry = new FulfillmentProviderRegistry([provider]);
    expect(() => registry.get('authorized-provider')).toThrow(ProviderNotConfiguredError);
    expect(() => new FulfillmentProviderRegistry([]).get('mock')).toThrow(
      ProviderNotConfiguredError,
    );
  });

  it('rejects two adapters with the same code', () => {
    expect(() => new FulfillmentProviderRegistry([provider, provider])).toThrow('Duplicate');
  });
});

describe('ObservedFulfillmentProvider', () => {
  afterEach(() => jest.restoreAllMocks());

  it('logs references, outcome and duration, never the recipient', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const observed = new ObservedFulfillmentProvider(
      new MockFulfillmentProvider({ scenario: 'SUCCESS', balance: 1_000n }),
    );
    const result = await observed.fulfill({
      clientReference: 'attempt-1',
      recipient: { type: 'ROBLOX_USER', identifier: 'SomeCustomerName', externalUserId: null },
      amount: 100,
      correlationId: 'req-9',
    });
    expect(result.status).toBe('SUCCEEDED');
    const entry = log.mock.calls[0]![0] as Record<string, unknown>;
    expect(entry).toMatchObject({
      event: 'fulfillment.provider_call',
      provider: 'mock',
      operation: 'fulfill',
      clientReference: 'attempt-1',
      providerReference: 'MOCK-000001',
      status: 'SUCCEEDED',
      correlationId: 'req-9',
    });
    expect(typeof entry.durationMs).toBe('number');
    expect(JSON.stringify(log.mock.calls)).not.toContain('SomeCustomerName');
  });

  it('logs and rethrows when an adapter throws', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const broken: FulfillmentProvider = {
      code: 'broken',
      getBalance: () => Promise.reject(new Error('socket hang up')),
      validateRecipient: () => Promise.reject(new Error('x')),
      fulfill: () => Promise.reject(new Error('x')),
      verify: () => Promise.reject(new Error('x')),
    };
    await expect(new ObservedFulfillmentProvider(broken).getBalance()).rejects.toThrow(
      'socket hang up',
    );
    expect(error.mock.calls[0]![0]).toMatchObject({ provider: 'broken', status: 'THREW' });
  });
});
