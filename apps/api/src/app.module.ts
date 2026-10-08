import { DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AppConfig } from './config/app-config';
import { AppConfigModule } from './config/app-config.module';
import { DatabaseModule } from './common/database/database.module';
import { HttpExceptionFilter } from './common/errors/http-exception.filter';
import { buildLoggerParams } from './common/logging/logger-options';
import { RedisModule } from './common/redis/redis.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { InventoryAdminModule } from './modules/inventory/inventory-admin.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { ProductsModule } from './modules/products/products.module';
import { UsersModule } from './modules/users/users.module';
import { TelegramModule } from './modules/telegram/telegram.module';
import { TreasuryModule } from './modules/treasury/treasury.module';

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        AppConfigModule.forRoot(config),
        LoggerModule.forRoot(buildLoggerParams(config)),
        DatabaseModule,
        RedisModule,
        HealthModule,
        AuthModule,
        UsersModule,
        OrdersModule,
        PaymentsModule,
        ProductsModule,
        InventoryAdminModule,
        TelegramModule,
        TreasuryModule,
      ],
      providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
    };
  }
}
