import type { FulfillmentProvider } from '../domain/fulfillment-provider';

/** A source names a provider this process has no adapter for (misconfiguration, never retried). */
export class ProviderNotConfiguredError extends Error {
  constructor(readonly providerCode: string) {
    super(`Fulfillment provider "${providerCode}" is not configured in this process`);
    this.name = 'ProviderNotConfiguredError';
  }
}

/**
 * The providers this process may call, by `fulfillment_sources.provider`. The fulfillment engine
 * asks the registry for the source's provider and never knows which adapter it receives. An
 * unknown code is an error, never a fallback to another provider.
 */
export class FulfillmentProviderRegistry {
  private readonly providers = new Map<string, FulfillmentProvider>();

  constructor(providers: readonly FulfillmentProvider[]) {
    for (const provider of providers) {
      if (this.providers.has(provider.code)) {
        throw new Error(`Duplicate fulfillment provider ${provider.code}`);
      }
      this.providers.set(provider.code, provider);
    }
  }

  get(code: string): FulfillmentProvider {
    const provider = this.providers.get(code);
    if (!provider) {
      throw new ProviderNotConfiguredError(code);
    }
    return provider;
  }

  has(code: string): boolean {
    return this.providers.has(code);
  }

  codes(): string[] {
    return [...this.providers.keys()];
  }
}

export const FULFILLMENT_PROVIDER_REGISTRY = Symbol('FULFILLMENT_PROVIDER_REGISTRY');
