import { Logger, Module } from '@nestjs/common';
import type { AppConfig } from '../../config/app-config';
import { InventoryModule } from '../inventory/inventory.module';
import { APP_CONFIG } from '../../config/app-config.module';
import {
  FULFILLMENT_PROVIDER_REGISTRY,
  FulfillmentProviderRegistry,
} from './application/fulfillment-provider.registry';
import { FulfillmentAttemptExecutor } from './application/fulfillment-attempt.executor';
import { FulfillmentAttemptVerifier } from './application/fulfillment-attempt.verifier';
import { FulfillmentEngine } from './application/fulfillment-engine.service';
import { FulfillmentAllocationService } from './application/fulfillment-allocation.service';
import { SourceHealthCheckService } from './application/source-health-check.service';
import { ObservedFulfillmentProvider } from './application/observed-fulfillment.provider';
import { FULFILLMENT_WORKFLOW_REPOSITORY } from './domain/fulfillment-workflow.repository';
import { configuredFulfillmentProviders } from './infrastructure/configured-providers';
import { PrismaFulfillmentWorkflowRepository } from './infrastructure/prisma-fulfillment-workflow.repository';

/**
 * Fulfillment engine (ARCHITECTURE.md §6.4) and the provider boundary (ADR-005). The engine reaches
 * providers only through the registry; adapters are created in `configuredFulfillmentProviders`.
 */
@Module({
  imports: [InventoryModule],
  providers: [
    {
      provide: FULFILLMENT_PROVIDER_REGISTRY,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => {
        const registry = new FulfillmentProviderRegistry(
          configuredFulfillmentProviders(config.fulfillment).map(
            (provider) => new ObservedFulfillmentProvider(provider),
          ),
        );
        new Logger(FulfillmentModule.name).log({
          event: 'fulfillment.providers_configured',
          providers: registry.codes(),
        });
        return registry;
      },
    },
    { provide: FULFILLMENT_WORKFLOW_REPOSITORY, useClass: PrismaFulfillmentWorkflowRepository },
    FulfillmentAllocationService,
    SourceHealthCheckService,
    FulfillmentAttemptExecutor,
    FulfillmentAttemptVerifier,
    FulfillmentEngine,
  ],
  exports: [FULFILLMENT_PROVIDER_REGISTRY, FulfillmentEngine, SourceHealthCheckService],
})
export class FulfillmentModule {}
