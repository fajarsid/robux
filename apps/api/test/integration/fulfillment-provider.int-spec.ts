import type { INestApplicationContext } from '@nestjs/common';
import {
  FULFILLMENT_PROVIDER_REGISTRY,
  type FulfillmentProviderRegistry,
  ProviderNotConfiguredError,
} from '../../src/modules/fulfillment/application/fulfillment-provider.registry';
import { WorkerModule } from '../../src/processes/worker/worker.module';
import { startProcessModule, testProcessConfig } from './support/test-queue';

/** Provider registry as the worker (and the Phase 9 engine in it) receives it. */
describe('fulfillment provider wiring in the worker', () => {
  const apps: INestApplicationContext[] = [];
  afterEach(async () => {
    for (const app of apps.splice(0)) {
      await app.close();
    }
  });

  async function registryOf(overrides: Record<string, string>) {
    const app = await startProcessModule(testProcessConfig('worker', overrides), WorkerModule);
    apps.push(app);
    return app.get<FulfillmentProviderRegistry>(FULFILLMENT_PROVIDER_REGISTRY);
  }

  it('has no provider unless one is configured', async () => {
    const registry = await registryOf({});
    expect(registry.codes()).toEqual([]);
    expect(() => registry.get('mock')).toThrow(ProviderNotConfiguredError);
  });

  it('serves the mock through the port when explicitly enabled', async () => {
    const registry = await registryOf({
      FULFILLMENT_PROVIDER: 'mock',
      MOCK_FULFILLMENT_BALANCE: '1000',
    });
    const provider = registry.get('mock');
    expect(await provider.getBalance()).toEqual({ status: 'AVAILABLE', units: 1000n });
    const result = await provider.fulfill({
      clientReference: 'wiring-1',
      recipient: { type: 'ROBLOX_USER', identifier: 'mock-valid-user', externalUserId: null },
      amount: 400,
    });
    expect(result.status).toBe('SUCCEEDED');
    expect(await provider.verify({ clientReference: 'wiring-1' })).toMatchObject({
      status: 'SUCCEEDED',
    });
  });

  it('refuses to start a production worker with the mock provider', () => {
    expect(() =>
      testProcessConfig('worker', { NODE_ENV: 'production', FULFILLMENT_PROVIDER: 'mock' }),
    ).toThrow('FULFILLMENT_PROVIDER=mock is not allowed in production');
  });
});
