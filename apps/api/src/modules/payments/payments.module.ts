import { Module } from '@nestjs/common';
import type { AppConfig } from '../../config/app-config';
import { APP_CONFIG } from '../../config/app-config.module';
import { OrdersModule } from '../orders/orders.module';
import { CreatePaymentService } from './application/create-payment.service';
import { PaymentQueriesService } from './application/payment-queries.service';
import { ProcessPaymentCallbackService } from './application/process-payment-callback.service';
import { VerifyPaymentService } from './application/verify-payment.service';
import { CustomerPaymentsController } from './controllers/customer-payments.controller';
import { GuestPaymentsController } from './controllers/guest-payments.controller';
import { PaymentCallbacksController } from './controllers/payment-callbacks.controller';
import { PaymentMethodsController } from './controllers/payment-methods.controller';
import {
  ConfiguredPaymentGatewayRegistry,
  type PaymentGateway,
  type PaymentGatewayResolver,
  PAYMENT_GATEWAY,
} from './domain/payment-gateway';
import { PAYMENT_OUTCOME_REPOSITORY } from './domain/payment-outcome.repository';
import { PAYMENT_REPOSITORY } from './domain/payment.repository';
import { WEBHOOK_EVENT_REPOSITORY } from './domain/webhook-event.repository';
import { DuitkuPaymentGateway } from './infrastructure/duitku/duitku-payment.gateway';
import { MockPaymentGateway } from './infrastructure/mock/mock-payment.gateway';
import { TelegramStarsPaymentGateway } from './infrastructure/telegram-stars/telegram-stars-payment.gateway';
import { PrismaPaymentOutcomeRepository } from './infrastructure/prisma-payment-outcome.repository';
import { PrismaPaymentRepository } from './infrastructure/prisma-payment.repository';
import { PrismaWebhookEventRepository } from './infrastructure/prisma-webhook-event.repository';

/**
 * The gateway is chosen by configuration (PAYMENT_GATEWAY). With `none` payment intake is off:
 * creation answers PAYMENT_GATEWAY_UNAVAILABLE and there is no simulated gateway.
 */
function selectGateway(config: AppConfig): PaymentGatewayResolver | null {
  const gateways: PaymentGateway[] = [];
  if (config.payments?.gateway === 'mock') gateways.push(new MockPaymentGateway());
  if (config.payments?.duitku) gateways.push(new DuitkuPaymentGateway(config.payments.duitku));
  if (config.payments?.telegramStarsEnabled) {
    if (!config.telegram)
      throw new Error('Telegram Stars requires TELEGRAM_BOT_TOKEN configuration');
    gateways.push(new TelegramStarsPaymentGateway(config.telegram.botToken));
  }
  return gateways.length === 0 ? null : new ConfiguredPaymentGatewayRegistry(gateways);
}

@Module({
  imports: [OrdersModule],
  controllers: [
    CustomerPaymentsController,
    GuestPaymentsController,
    PaymentMethodsController,
    PaymentCallbacksController,
  ],
  providers: [
    CreatePaymentService,
    PaymentQueriesService,
    ProcessPaymentCallbackService,
    VerifyPaymentService,
    { provide: PAYMENT_GATEWAY, inject: [APP_CONFIG], useFactory: selectGateway },
    { provide: PAYMENT_REPOSITORY, useClass: PrismaPaymentRepository },
    { provide: PAYMENT_OUTCOME_REPOSITORY, useClass: PrismaPaymentOutcomeRepository },
    { provide: WEBHOOK_EVENT_REPOSITORY, useClass: PrismaWebhookEventRepository },
  ],
  exports: [
    VerifyPaymentService,
    CreatePaymentService,
    PaymentQueriesService,
    ProcessPaymentCallbackService,
    PAYMENT_GATEWAY,
    PAYMENT_REPOSITORY,
  ],
})
export class PaymentsModule {}
