import { Module } from '@nestjs/common';
import { APP_CONFIG } from '../../config/app-config.module';
import type { AppConfig } from '../../config/app-config';
import { AesGcmSecretCipher } from '../../common/security/aes-gcm-secret.cipher';
import { AuditModule } from '../audit/audit.module';
import { ProductsModule } from '../products/products.module';
import { SettingsModule } from '../settings/settings.module';
import { CancelOrderService } from './application/cancel-order.service';
import { CreateOrderService } from './application/create-order.service';
import { ExpireUnpaidOrdersService } from './application/expire-unpaid-orders.service';
import { QueuePaidOrderService } from './application/queue-paid-order.service';
import { OrderQueriesService } from './application/order-queries.service';
import { DigitalAccountHandoffService } from './application/digital-account-handoff.service';
import { PayableOrderService } from './application/payable-order.service';
import {
  ORDER_REPLAY_CIPHER,
  ReplayableResponseCodec,
} from './application/replayable-response.codec';
import { AdminOrdersController } from './controllers/admin-orders.controller';
import { CustomerOrdersController } from './controllers/customer-orders.controller';
import { GuestOrderTrackingController } from './controllers/guest-order-tracking.controller';
import { OrdersController } from './controllers/orders.controller';
import { ORDER_CREATION_REPOSITORY } from './domain/order-creation.repository';
import { ORDER_NUMBER_ALLOCATOR } from './domain/order-number-allocator';
import { ORDER_READ_REPOSITORY } from './domain/order-read.repository';
import { ORDER_STATUS_TRANSITION_REPOSITORY } from './domain/order-status-transition.repository';
import { PrismaOrderCreationRepository } from './infrastructure/prisma-order-creation.repository';
import { PrismaOrderNumberAllocator } from './infrastructure/prisma-order-number.allocator';
import { PrismaOrderReadRepository } from './infrastructure/prisma-order-read.repository';
import { PrismaOrderStatusTransitionRepository } from './infrastructure/prisma-order-status-transition.repository';

const repositories = [
  { provide: ORDER_READ_REPOSITORY, useClass: PrismaOrderReadRepository },
  { provide: ORDER_STATUS_TRANSITION_REPOSITORY, useClass: PrismaOrderStatusTransitionRepository },
];

/** HTTP-facing order engine (API process). */
@Module({
  imports: [ProductsModule, SettingsModule, AuditModule],
  controllers: [
    OrdersController,
    CustomerOrdersController,
    GuestOrderTrackingController,
    AdminOrdersController,
  ],
  providers: [
    ...repositories,
    OrderQueriesService,
    DigitalAccountHandoffService,
    PayableOrderService,
    CreateOrderService,
    CancelOrderService,
    ReplayableResponseCodec,
    { provide: ORDER_CREATION_REPOSITORY, useClass: PrismaOrderCreationRepository },
    { provide: ORDER_NUMBER_ALLOCATOR, useClass: PrismaOrderNumberAllocator },
    {
      provide: ORDER_REPLAY_CIPHER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => {
        if (!config.orders) {
          throw new Error('Orders configuration is required for the API');
        }
        return new AesGcmSecretCipher(
          config.orders.idempotencyEncryptionKey,
          config.orders.idempotencyEncryptionKeyVersion,
        );
      },
    },
  ],
  exports: [PayableOrderService, CreateOrderService, DigitalAccountHandoffService],
})
export class OrdersModule {}

/** Background order lifecycle work (worker process): no controllers, no request-scoped config. */
@Module({
  providers: [...repositories, ExpireUnpaidOrdersService, QueuePaidOrderService],
  exports: [ExpireUnpaidOrdersService, QueuePaidOrderService],
})
export class OrderLifecycleJobsModule {}
