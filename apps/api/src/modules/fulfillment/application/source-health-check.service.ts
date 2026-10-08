import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  SOURCE_HEALTH_REPOSITORY,
  type SourceHealthRepository,
} from '../../inventory/domain/source-health.repository';
import {
  FULFILLMENT_PROVIDER_REGISTRY,
  type FulfillmentProviderRegistry,
} from './fulfillment-provider.registry';

export interface HealthCheckSummary {
  probed: number;
  healthy: number;
}

/**
 * Brings sources back into routing once their provider answers again. The provider balance is a
 * liveness probe only and is not written into our ledger, which stays the authority for
 * reservations (provider balance reconciliation is a later phase).
 */
@Injectable()
export class SourceHealthCheckService {
  private readonly logger = new Logger(SourceHealthCheckService.name);

  constructor(
    @Inject(SOURCE_HEALTH_REPOSITORY) private readonly sources: SourceHealthRepository,
    @Inject(FULFILLMENT_PROVIDER_REGISTRY) private readonly registry: FulfillmentProviderRegistry,
  ) {}

  async checkUnavailableSources(now = new Date()): Promise<HealthCheckSummary> {
    let probed = 0;
    let healthy = 0;
    for (const source of await this.sources.sourcesToProbe()) {
      if (!this.registry.has(source.provider)) {
        continue;
      }
      probed += 1;
      let ok = false;
      try {
        ok = (await this.registry.get(source.provider).getBalance()).status === 'AVAILABLE';
      } catch {
        ok = false;
      }
      await this.sources.recordProbe(source.id, ok, now);
      if (ok) {
        healthy += 1;
        this.logger.log({ event: 'inventory.source_recovered', sourceId: source.id });
      }
    }
    return { probed, healthy };
  }
}
