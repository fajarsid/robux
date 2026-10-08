import type { NestExpressApplication } from '@nestjs/platform-express';
import { createHmac, randomBytes } from 'node:crypto';
import request from 'supertest';
import { AesGcmSecretCipher } from '../../src/common/security/aes-gcm-secret.cipher';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { WorkerModule } from '../../src/processes/worker/worker.module';
import { createProductWithPrice, createSource } from './support/fixtures';
import { createTestApp } from './support/test-app';
import { createTestPrisma } from './support/test-database';
import { startProcessModule, testProcessConfig, waitFor } from './support/test-queue';

describe('Telegram Mini App account commerce (Core E2E)', () => {
  let api: NestExpressApplication;
  let prisma: PrismaClient;
  let worker: Awaited<ReturnType<typeof startProcessModule>>;
  const botToken = '123456:integration-bot-token';
  const webhookSecret = 'integration-webhook-secret';
  const encryptionKey = 'a'.repeat(64);
  const botFetch = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);

  beforeAll(async () => {
    api = await createTestApp({
      PAYMENT_GATEWAY: 'mock',
      FULFILLMENT_PROVIDER: 'mock',
      TELEGRAM_BOT_TOKEN: botToken,
      TELEGRAM_WEBHOOK_SECRET: webhookSecret,
      TELEGRAM_MINI_APP_URL: 'https://store.test/telegram-store',
      ACCOUNT_INVENTORY_ENCRYPTION_KEY: encryptionKey,
    });
    prisma = createTestPrisma();
  });

  afterAll(async () => {
    await worker?.close();
    await api?.close();
    await prisma?.$disconnect();
    botFetch.mockRestore();
  });

  it('runs catalog → order → verified mock payment → worker fulfillment → owner-only secure handoff', async () => {
    const key = Buffer.from(encryptionKey, 'hex');
    const source = await createSource(prisma, 1n, { productLine: 'TELEGRAM_ACCOUNT' });
    const offer = await createProductWithPrice(prisma, {
      productLine: 'TELEGRAM_ACCOUNT', robuxAmount: 1, sellingPrice: '150000',
    });
    const credential = { username: `account_${Date.now()}`, password: `secret-${randomBytes(8).toString('hex')}` };
    const cipher = new AesGcmSecretCipher(key, 1);
    const inventory = await prisma.digitalInventoryItem.create({
      data: {
        productId: offer.product.id,
        sourceId: source.id,
        encryptedPayload: new Uint8Array(cipher.encrypt(Buffer.from(JSON.stringify(credential)))),
        keyVersion: 1,
      },
    });

    worker = await startProcessModule(testProcessConfig('worker', {
      FULFILLMENT_PROVIDER: 'mock', MOCK_FULFILLMENT_SCENARIO: 'SUCCESS',
    }), WorkerModule);

    const telegramUserId = 812345678;
    const authorization = `tma ${signedInitData(botToken, telegramUserId)}`;
    const catalog = await fetchApi('get', '/api/v1/telegram/miniapp/catalog', undefined, authorization);
    expect(catalog.status).toBe(200);
    expect(catalog.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: offer.product.id, productLine: 'TELEGRAM_ACCOUNT', availability: 'AVAILABLE' }),
    ]));
    expect(JSON.stringify(catalog.body)).not.toContain(credential.password);

    const body = {
      productId: offer.product.id, priceVersionId: offer.price.id, quantity: 1, contactEmail: 'buyer@example.test',
    };
    const createKey = randomBytes(16).toString('hex');
    const orderResponse = await fetchApi('post', '/api/v1/telegram/miniapp/orders', body, authorization, { 'Idempotency-Key': createKey });
    expect(orderResponse.status).toBe(201);
    const orderReference = orderResponse.body.reference as string;
    expect(orderResponse.body).not.toHaveProperty('id');
    expect(orderResponse.body).not.toHaveProperty('trackingToken');
    expect(orderResponse.body.amount).toBe('150000.00');
    const replayed = await fetchApi('post', '/api/v1/telegram/miniapp/orders', body, authorization, { 'Idempotency-Key': createKey });
    expect(replayed.body.reference).toBe(orderReference);
    const orderId = (await prisma.order.findUniqueOrThrow({ where: { orderNumber: orderReference } })).id;
    expect((await fetchApi('post', `/api/v1/telegram/miniapp/orders/${orderReference}/handoff`, {}, authorization)).status).toBe(404);

    const payment = await fetchApi('post', `/api/v1/telegram/miniapp/orders/${orderReference}/payment`, { paymentMethod: 'MK' }, authorization, { 'Idempotency-Key': randomBytes(16).toString('hex') });
    expect(payment.status).toBe(201);
    expect(payment.body.payment.status).toBe('PENDING');
    const settled = await fetchApi('post', `/api/v1/telegram/miniapp/orders/${orderReference}/mock-payment`, { outcome: 'PAID' }, authorization);
    expect(settled.status).toBe(200);
    expect((await fetchApi('post', `/api/v1/telegram/miniapp/orders/${orderReference}/mock-payment`, { outcome: 'PAID' }, authorization)).status).toBe(200);

    await waitFor(async () => {
      const order = await prisma.order.findUnique({ where: { id: orderId }, select: { status: true } });
      return order?.status === 'FULFILLED' ? order : null;
    });
    const sold = await prisma.digitalInventoryItem.findUniqueOrThrow({ where: { id: inventory.id } });
    expect(sold).toMatchObject({ orderId, status: 'SOLD' });

    const ordinary = await fetchApi('get', `/api/v1/telegram/miniapp/orders/${orderReference}`, undefined, authorization);
    expect(ordinary.status).toBe(200);
    expect(JSON.stringify(ordinary.body)).not.toContain(credential.password);
    const handoff = await fetchApi('post', `/api/v1/telegram/miniapp/orders/${orderReference}/handoff`, {}, authorization);
    expect(handoff.status).toBe(201);
    expect(handoff.body).toEqual([credential]);
    expect((await prisma.digitalInventoryItem.findUniqueOrThrow({ where: { id: inventory.id } })).status).toBe('DELIVERED');

    const otherUser = `tma ${signedInitData(botToken, telegramUserId + 1)}`;
    expect((await fetchApi('get', `/api/v1/telegram/miniapp/orders/${orderReference}`, undefined, otherUser)).status).toBe(404);
    expect((await fetchApi('post', `/api/v1/telegram/miniapp/orders/${orderReference}/handoff`, {}, otherUser)).status).toBe(404);
  });

  async function fetchApi(method: 'get' | 'post', path: string, body: object | undefined, authorization: string, headers: Record<string, string> = {}) {
    const call = request(api.getHttpServer())[method](path)
      .set('Authorization', authorization).set('X-Forwarded-For', '10.5.5.5');
    for (const [name, value] of Object.entries(headers)) call.set(name, value);
    return body === undefined ? call : call.send(body);
  }
});

function signedInitData(token: string, id: number): string {
  const values = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: `query-${id}`,
    user: JSON.stringify({ id, username: `user_${id}` }),
  });
  const check = [...values.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  values.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return values.toString();
}
