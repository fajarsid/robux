import { DynamicModule, Module, Type } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AppConfig } from '../../config/app-config';
import { AppConfigModule } from '../../config/app-config.module';
import { DatabaseModule } from '../../common/database/database.module';
import { DependencyHealthModule } from '../../common/health/dependency-health.module';
import { basePinoOptions } from '../../common/logging/logger-options';
import { RedisModule } from '../../common/redis/redis.module';
import { Heartbeat } from './heartbeat';
import { ProcessHealthServer } from './process-health.server';

/**
 * Shared wiring for non-HTTP processes (worker, scheduler). `processModule` holds the process's
 * runtime and must export `READINESS_PROBES`.
 */
@Module({})
export class BackgroundProcessModule {
  static forRoot(config: AppConfig, processModule: Type<unknown>): DynamicModule {
    return {
      module: BackgroundProcessModule,
      imports: [
        AppConfigModule.forRoot(config),
        LoggerModule.forRoot({ pinoHttp: basePinoOptions(config) }),
        DatabaseModule,
        RedisModule,
        DependencyHealthModule,
        processModule,
      ],
      providers: [Heartbeat, ProcessHealthServer],
    };
  }
}
