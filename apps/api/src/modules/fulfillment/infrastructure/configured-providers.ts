import { randomUUID } from 'node:crypto';
import type { FulfillmentConfig } from '../../../config/fulfillment-config';
import type { FulfillmentProvider } from '../domain/fulfillment-provider';
import { MockFulfillmentProvider } from './providers/mock/mock-fulfillment.provider';

/**
 * The only place that knows which adapters exist. Configuration has already refused the mock in
 * production and any unknown provider name, so nothing here can silently substitute a provider.
 */
export function configuredFulfillmentProviders(config: FulfillmentConfig): FulfillmentProvider[] {
  if (config.provider === 'mock' && config.mock) {
    return [
      new MockFulfillmentProvider({
        ...config.mock,
        referencePrefix: `MOCK-${randomUUID().slice(0, 8)}`,
      }),
    ];
  }
  return [];
}
