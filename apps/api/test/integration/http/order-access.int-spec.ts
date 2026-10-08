import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import { generateGuestTrackingToken } from '../../../src/modules/orders/domain/guest-tracking-token';
import { createOrder, createProductWithPrice } from '../support/fixtures';
import { createTestApp, createUser, randomTestIp, TestBrowser } from '../support/test-app';
import { createTestPrisma } from '../support/test-database';

describe('order access: IDOR and guest tracking', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = createTestPrisma();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  /** An order with a known plaintext tracking token, optionally owned by a customer. */
  async function orderFor(userId: string | null) {
    const { product, price } = await createProductWithPrice(prisma);
    const order = await createOrder(prisma, { product, price, quantity: 2 });
    const tracking = generateGuestTrackingToken();
    await prisma.order.update({
      where: { id: order.id },
      data: { userId, trackingTokenHash: tracking.hash },
    });
    return { order, token: tracking.token };
  }

  describe('customer orders (IDOR)', () => {
    it('lists and returns only the signed-in customer orders', async () => {
      const alice = await createUser(prisma, 'CUSTOMER', 'alice');
      const bob = await createUser(prisma, 'CUSTOMER', 'bob');
      const aliceOrder = (await orderFor(alice.id)).order;
      const bobOrder = (await orderFor(bob.id)).order;
      const guestOrder = (await orderFor(null)).order;

      const browser = new TestBrowser(app);
      await browser.login(alice.email);

      const list = await browser.get('/api/v1/me/orders');
      expect(list.status).toBe(200);
      expect(list.body.map((o: { id: string }) => o.id)).toEqual([aliceOrder.id]);
      expect(list.body[0]).toMatchObject({ totalRobux: 1000, stage: 'AWAITING_PAYMENT' });

      expect((await browser.get(`/api/v1/me/orders/${aliceOrder.id}`)).status).toBe(200);
      for (const foreignId of [bobOrder.id, guestOrder.id, randomUUID()]) {
        const response = await browser.get(`/api/v1/me/orders/${foreignId}`);
        expect(response.status).toBe(404);
        expect(response.body.code).toBe('ORDER_NOT_FOUND');
      }
      expect((await browser.get('/api/v1/me/orders/not-a-uuid')).status).toBe(400);
    });
  });

  describe('guest tracking', () => {
    const PUBLIC_FIELDS = [
      'cancellable',
      'createdAt',
      'currency',
      'fulfillmentType',
      'items',
      'orderNumber',
      'paymentExpiresAt',
      'platform',
      'pricing',
      'productLine',
      'recipientType',
      'recipientUsername',
      'stage',
      'timeline',
      'total',
      'unit',
    ];

    it('returns only public tracking fields for a valid token', async () => {
      const { order, token } = await orderFor(null);
      const response = await new TestBrowser(app).get(`/api/v1/track/${token}`);
      expect(response.status).toBe(200);
      expect(Object.keys(response.body).sort()).toEqual(PUBLIC_FIELDS);
      expect(response.body).toMatchObject({
        orderNumber: order.orderNumber,
        stage: 'AWAITING_PAYMENT',
        total: '138000.00',
        productLine: 'ROBLOX_ROBUX',
        platform: 'ROBLOX',
        fulfillmentType: 'BALANCE_PURCHASE',
        recipientType: 'ROBLOX_USER',
        unit: 'ROBUX',
      });
      expect(Object.keys(response.body.items[0]).sort()).toEqual([
        'lineSubtotal',
        'productName',
        'quantity',
        'robuxAmount',
        'unitPrice',
      ]);
      const serialised = JSON.stringify(response.body);
      for (const secret of [
        order.id,
        order.trackingTokenHash,
        order.idempotencyKey,
        order.contactEmail,
        token,
      ]) {
        expect(serialised).not.toContain(secret);
      }
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['referrer-policy']).toBe('no-referrer');
    });

    it('gives the same 404 for unknown, malformed and guessed tokens', async () => {
      const { order } = await orderFor(null);
      const browser = new TestBrowser(app);
      const candidates = [
        generateGuestTrackingToken().token,
        'short',
        order.orderNumber,
        order.id,
        order.trackingTokenHash,
        '1',
      ];
      for (const candidate of candidates) {
        const response = await browser.get(`/api/v1/track/${encodeURIComponent(candidate)}`);
        expect(response.status).toBe(404);
        expect(response.body.code).toBe('ORDER_NOT_FOUND');
      }
    });

    it('rate-limits tracking lookups per client', async () => {
      const ip = randomTestIp();
      const statuses: number[] = [];
      let retryAfter: string | undefined;
      for (let i = 0; i < 32; i += 1) {
        const response = await request(app.getHttpServer())
          .get(`/api/v1/track/${generateGuestTrackingToken().token}`)
          .set('X-Forwarded-For', ip);
        statuses.push(response.status);
        retryAfter ??= response.headers['retry-after'];
      }
      expect(statuses.slice(0, 30).every((s) => s === 404)).toBe(true);
      expect(statuses.slice(30)).toEqual([429, 429]);
      expect(Number(retryAfter)).toBeGreaterThan(0);
    });

    it('is reachable without an account (guest checkout stays account-free)', async () => {
      const { token } = await orderFor(null);
      const anonymous = await request(app.getHttpServer())
        .get(`/api/v1/track/${token}`)
        .set('X-Forwarded-For', randomTestIp());
      expect(anonymous.status).toBe(200);
    });
  });
});
