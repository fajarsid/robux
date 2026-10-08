import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import type { AppConfig } from '../../../src/config/app-config';
import { APP_CONFIG } from '../../../src/config/app-config.module';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import { PAYMENT_GATEWAY } from '../../../src/modules/payments/domain/payment-gateway';
import { DuitkuPaymentGateway } from '../../../src/modules/payments/infrastructure/duitku/duitku-payment.gateway';
import { DuitkuStub, STUB_API_KEY, STUB_MERCHANT_CODE } from './duitku-stub';
import { createProductWithPrice } from './fixtures';
import { createTestApp, TestBrowser } from './test-app';

export const ENABLED_METHODS = ['BC', 'SP', 'LF'];

/** The API with the real Duitku adapter, talking to a local stub instead of Duitku. */
export async function createPaymentsTestApp(
  stub: DuitkuStub,
  overrides: Record<string, string> = {},
): Promise<NestExpressApplication> {
  return createTestApp(
    {
      PAYMENT_GATEWAY: 'duitku',
      DUITKU_ENVIRONMENT: 'sandbox',
      DUITKU_MERCHANT_CODE: STUB_MERCHANT_CODE,
      DUITKU_API_KEY: STUB_API_KEY,
      DUITKU_CALLBACK_URL: 'http://api.test/api/v1/webhooks/payments/duitku',
      DUITKU_RETURN_URL: 'http://app.test/payment/return',
      DUITKU_PAYMENT_METHODS: ENABLED_METHODS.join(','),
      ...overrides,
    },
    (builder) =>
      builder.overrideProvider(PAYMENT_GATEWAY).useFactory({
        inject: [APP_CONFIG],
        factory: (config: AppConfig) =>
          new DuitkuPaymentGateway(config.payments!.duitku!, stub.fetch),
      }),
  );
}

export const newKey = () => randomBytes(16).toString('hex');

export async function placeGuestOrder(app: NestExpressApplication, prisma: PrismaClient) {
  const offer = await createProductWithPrice(prisma, { sellingPrice: '69000' });
  const browser = new TestBrowser(app);
  const response = await browser.send(
    'post',
    '/api/v1/orders',
    {
      productId: offer.product.id,
      priceVersionId: offer.price.id,
      quantity: 2,
      recipient: { robloxUsername: 'Builder_Kid' },
      contactEmail: 'guest@example.test',
    },
    { headers: { 'Idempotency-Key': newKey() } },
  );
  if (response.status !== 201) {
    throw new Error(`Order creation failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  const order = await prisma.order.findUniqueOrThrow({
    where: { orderNumber: response.body.orderNumber as string },
  });
  return { browser, order, token: response.body.trackingToken as string };
}

export function payAsGuest(
  browser: TestBrowser,
  token: string,
  paymentMethod = 'BC',
  key: string | null = newKey(),
) {
  return browser.send(
    'post',
    `/api/v1/track/${token}/payment`,
    { paymentMethod },
    {
      headers: key === null ? {} : { 'Idempotency-Key': key },
    },
  );
}

/** Posts a callback exactly as Duitku does: form encoded, no Origin, no session. */
export function postCallback(app: NestExpressApplication, form: Record<string, string>) {
  return request(app.getHttpServer())
    .post('/api/v1/webhooks/payments/duitku')
    .set('X-Forwarded-For', '182.23.85.11')
    .type('form')
    .send(form);
}
