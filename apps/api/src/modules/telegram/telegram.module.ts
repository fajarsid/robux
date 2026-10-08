import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { ProductsModule } from '../products/products.module';
import { TelegramBotModule } from './telegram-bot.module';
import { TelegramMiniAppAuthService } from './telegram-miniapp-auth.service';
import {
  TelegramMiniAppController,
  TelegramWebhookController,
} from './telegram-miniapp.controller';
import { TelegramStarsUpdateService } from './telegram-stars-update.service';

@Module({
  imports: [OrdersModule, PaymentsModule, ProductsModule, TelegramBotModule],
  controllers: [TelegramMiniAppController, TelegramWebhookController],
  providers: [TelegramMiniAppAuthService, TelegramStarsUpdateService],
})
export class TelegramModule {}
