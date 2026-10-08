import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomBytes, randomUUID } from 'node:crypto';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import { ExpireUnpaidOrdersService } from '../../../src/modules/orders/application/expire-unpaid-orders.service';
import { hashGuestTrackingToken } from '../../../src/modules/orders/domain/guest-tracking-token';
import { PrismaOrderStatusTransitionRepository } from '../../../src/modules/orders/infrastructure/prisma-order-status-transition.repository';
import { createProductWithPrice, createSource } from '../support/fixtures';
import { createTestApp, signInAs, TestBrowser } from '../support/test-app';
import { asPrismaService, createTestPrisma } from '../support/test-database';

const ORDER_NUMBER = /^RBX-\d{8}-\d{5}$/;

const newKey = () => randomBytes(16).toString('hex');

describe('order engine', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = createTestPrisma();
    // Enough stock for every ordinary product in this suite.
    await createSource(prisma, 50_000_000n);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function product(options: { sellingPrice?: string } = {}) {
    return createProductWithPrice(prisma, options);
  }

  function orderBody(
    offer: { product: { id: string }; price: { id: string } },
    overrides: Record<string, unknown> = {},
  ) {
    return {
      productId: offer.product.id,
      priceVersionId: offer.price.id,
      quantity: 2,
      recipient: { robloxUsername: 'Builder_Kid' },
      contactEmail: 'Guest@Example.test',
      ...overrides,
    };
  }

  function placeOrder(browser: TestBrowser, body: object, key: string | null = newKey()) {
    return browser.send('post', '/api/v1/orders', body, {
      headers: key === null ? {} : { 'Idempotency-Key': key },
    });
  }

  describe('creation', () => {
    it('creates a guest order awaiting payment with an immutable backend price snapshot', async () => {
      const offer = await product({ sellingPrice: '69000' });
      const response = await placeOrder(new TestBrowser(app), orderBody(offer));

      expect(response.status).toBe(201);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).toMatchObject({
        stage: 'AWAITING_PAYMENT',
        recipientUsername: 'Builder_Kid',
        pricing: {
          currency: 'IDR',
          unitPrice: '69000.00',
          quantity: 2,
          subtotal: '138000.00',
          discount: '0.00',
          fee: '0.00',
          tax: '0.00',
          total: '138000.00',
        },
      });
      expect(response.body.orderNumber).toMatch(ORDER_NUMBER);
      expect(response.body).not.toHaveProperty('orderId');
      expect(typeof response.body.trackingToken).toBe('string');

      const order = await prisma.order.findUniqueOrThrow({
        where: { orderNumber: response.body.orderNumber },
        include: { items: true, statusHistory: { orderBy: { createdAt: 'asc' } } },
      });
      expect(order).toMatchObject({
        status: 'PAYMENT_PENDING',
        userId: null,
        contactEmail: 'guest@example.test',
        currency: 'IDR',
        fulfillmentMethod: 'INSTANT',
        recipientRobloxUserId: null,
      });
      expect(order.trackingTokenHash).toBe(hashGuestTrackingToken(response.body.trackingToken));
      expect(order.paymentExpiresAt!.getTime()).toBeGreaterThan(order.createdAt.getTime());
      expect(order.total.toString()).toBe('138000');
      expect(order.items).toHaveLength(1);
      expect(order.items[0]).toMatchObject({
        productId: offer.product.id,
        productPriceId: offer.price.id,
        productNameSnapshot: 'Test Robux',
        robuxAmount: 500,
        quantity: 2,
      });
      expect(order.statusHistory.map((h) => [h.fromStatus, h.toStatus])).toEqual([
        [null, 'CREATED'],
        ['CREATED', 'PAYMENT_PENDING'],
      ]);
      const events = await prisma.outboxEvent.findMany({ where: { aggregateId: order.id } });
      expect(events.map((e) => e.eventType)).toEqual(['ORDER_CREATED']);

      // A later price change does not touch the stored order.
      await prisma.productPrice.create({
        data: {
          productId: offer.product.id,
          version: 2,
          sellingPrice: '99000',
          costPrice: '60000',
          currency: 'IDR',
          effectiveFrom: new Date(Date.now() - 1000),
        },
      });
      const tracked = await new TestBrowser(app).get(
        `/api/v1/track/${response.body.trackingToken}`,
      );
      expect(tracked.status).toBe(200);
      expect(tracked.body.pricing.total).toBe('138000.00');
      expect(tracked.body.cancellable).toBe(true);
    });

    it('creates a customer order owned by the signed-in customer, using the account email', async () => {
      const offer = await product();
      const { user, browser } = await signInAs(app, prisma, 'CUSTOMER');
      const response = await placeOrder(browser, orderBody(offer, { contactEmail: undefined }));

      expect(response.status).toBe(201);
      expect(typeof response.body.orderId).toBe('string');
      const order = await prisma.order.findUniqueOrThrow({ where: { id: response.body.orderId } });
      expect(order.userId).toBe(user.id);
      expect(order.contactEmail).toBe(user.email);

      const mine = await browser.get(`/api/v1/me/orders/${response.body.orderId}`);
      expect(mine.status).toBe(200);
    });

    it('requires a contact email from guests', async () => {
      const offer = await product();
      const response = await placeOrder(
        new TestBrowser(app),
        orderBody(offer, { contactEmail: undefined }),
      );
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_FAILED');
    });

    it('gives concurrent orders distinct, well-formed order numbers', async () => {
      const offer = await product();
      const responses = await Promise.all(
        Array.from({ length: 8 }, () => placeOrder(new TestBrowser(app), orderBody(offer))),
      );
      expect(responses.map((r) => r.status)).toEqual(Array(8).fill(201));
      const numbers = responses.map((r) => r.body.orderNumber as string);
      expect(new Set(numbers).size).toBe(8);
      for (const number of numbers) {
        expect(number).toMatch(ORDER_NUMBER);
      }
    });
  });

  describe('pricing and product validation', () => {
    it('rejects an order quoted against an old price version with PRICE_CHANGED', async () => {
      const offer = await product();
      await prisma.productPrice.create({
        data: {
          productId: offer.product.id,
          version: 2,
          sellingPrice: '75000',
          costPrice: '50000',
          currency: 'IDR',
          effectiveFrom: new Date(Date.now() - 1000),
        },
      });
      const response = await placeOrder(new TestBrowser(app), orderBody(offer));
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('PRICE_CHANGED');
      expect(
        await prisma.order.count({ where: { items: { some: { productId: offer.product.id } } } }),
      ).toBe(0);
    });

    it('never accepts a total, price or discount from the client', async () => {
      const offer = await product();
      for (const extra of [
        { total: '1' },
        { unitPrice: '1' },
        { discount: '69000' },
        { clientTotal: 1 },
      ]) {
        const response = await placeOrder(new TestBrowser(app), orderBody(offer, extra));
        expect(response.status).toBe(400);
        expect(response.body.code).toBe('VALIDATION_FAILED');
      }
    });

    it('rejects unknown, inactive and archived products', async () => {
      const unknown = await placeOrder(
        new TestBrowser(app),
        orderBody({ product: { id: randomUUID() }, price: { id: randomUUID() } }),
      );
      expect(unknown.status).toBe(404);
      expect(unknown.body.code).toBe('PRODUCT_NOT_FOUND');

      const inactive = await product();
      await prisma.product.update({
        where: { id: inactive.product.id },
        data: { isActive: false },
      });
      const inactiveResponse = await placeOrder(new TestBrowser(app), orderBody(inactive));
      expect(inactiveResponse.status).toBe(409);
      expect(inactiveResponse.body.code).toBe('PRODUCT_INACTIVE');

      const archived = await product();
      await prisma.product.update({
        where: { id: archived.product.id },
        data: { archivedAt: new Date() },
      });
      const archivedResponse = await placeOrder(new TestBrowser(app), orderBody(archived));
      expect(archivedResponse.status).toBe(404);
      expect(archivedResponse.body.code).toBe('PRODUCT_NOT_FOUND');
    });

    it('rejects a product the stock cannot cover', async () => {
      const offer = await product();
      await prisma.product.update({
        where: { id: offer.product.id },
        data: { robuxAmount: 1_000_000, minQuantity: 100, maxQuantity: 100 },
      });
      const response = await placeOrder(new TestBrowser(app), orderBody(offer, { quantity: 100 }));
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('PRODUCT_UNAVAILABLE');
    });

    it('enforces the product quantity limits', async () => {
      const offer = await product();
      const response = await placeOrder(new TestBrowser(app), orderBody(offer, { quantity: 11 }));
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('QUANTITY_OUT_OF_RANGE');
    });

    it('validates the Roblox username format', async () => {
      const offer = await product();
      for (const robloxUsername of [
        'ab',
        'a'.repeat(21),
        'bad name',
        '_lead',
        'two__under',
        'a_b_c',
      ]) {
        const response = await placeOrder(
          new TestBrowser(app),
          orderBody(offer, { recipient: { robloxUsername } }),
        );
        expect(response.status).toBe(400);
      }
    });
  });

  describe('idempotency', () => {
    it('requires a well-formed Idempotency-Key header', async () => {
      const offer = await product();
      for (const key of [null, 'short', 'has spaces in the key!!', 'x'.repeat(129)]) {
        const response = await placeOrder(new TestBrowser(app), orderBody(offer), key);
        expect(response.status).toBe(400);
        expect(response.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
      }
    });

    it('returns the original order for a retried request instead of creating another', async () => {
      const offer = await product();
      const browser = new TestBrowser(app);
      const key = newKey();
      const first = await placeOrder(browser, orderBody(offer), key);
      const retry = await placeOrder(browser, orderBody(offer), key);

      expect(first.status).toBe(201);
      expect(retry.status).toBe(201);
      expect(retry.headers['idempotent-replayed']).toBe('true');
      expect(first.headers['idempotent-replayed']).toBeUndefined();
      expect(retry.body).toEqual(first.body);

      const stored = await prisma.idempotencyKey.findFirstOrThrow({ where: { key } });
      expect(stored.status).toBe('COMPLETED');
      expect(JSON.stringify(stored.responseBody)).not.toContain(first.body.trackingToken);
      expect(
        await prisma.order.count({ where: { items: { some: { productId: offer.product.id } } } }),
      ).toBe(1);
    });

    it('creates exactly one order for concurrent requests with the same key', async () => {
      const offer = await product();
      const key = newKey();
      const responses = await Promise.all(
        Array.from({ length: 6 }, () => placeOrder(new TestBrowser(app), orderBody(offer), key)),
      );
      expect(responses.map((r) => r.status)).toEqual(Array(6).fill(201));
      expect(new Set(responses.map((r) => r.body.orderNumber)).size).toBe(1);
      expect(new Set(responses.map((r) => r.body.trackingToken)).size).toBe(1);
      expect(
        await prisma.order.count({ where: { items: { some: { productId: offer.product.id } } } }),
      ).toBe(1);
    });

    it('rejects reusing a key for a different request', async () => {
      const offer = await product();
      const key = newKey();
      expect((await placeOrder(new TestBrowser(app), orderBody(offer), key)).status).toBe(201);
      const changed = await placeOrder(
        new TestBrowser(app),
        orderBody(offer, { quantity: 3 }),
        key,
      );
      expect(changed.status).toBe(422);
      expect(changed.body.code).toBe('DUPLICATE_IDEMPOTENCY_KEY');
    });

    it('scopes keys per customer, so another customer cannot replay a response', async () => {
      const offer = await product();
      const key = newKey();
      const alice = await signInAs(app, prisma, 'CUSTOMER');
      const bob = await signInAs(app, prisma, 'CUSTOMER');
      const body = orderBody(offer, { contactEmail: undefined });
      const aliceOrder = await placeOrder(alice.browser, body, key);
      const bobOrder = await placeOrder(bob.browser, body, key);
      expect(aliceOrder.status).toBe(201);
      expect(bobOrder.status).toBe(201);
      expect(bobOrder.headers['idempotent-replayed']).toBeUndefined();
      expect(bobOrder.body.orderNumber).not.toBe(aliceOrder.body.orderNumber);

      const guest = await placeOrder(new TestBrowser(app), orderBody(offer), key);
      expect(guest.status).toBe(201);
      expect(guest.body.orderNumber).not.toBe(aliceOrder.body.orderNumber);
    });
  });

  describe('authorization', () => {
    it('does not let staff accounts place orders', async () => {
      const offer = await product();
      for (const role of ['OPERATOR', 'ADMIN', 'SUPER_ADMIN'] as const) {
        const { browser } = await signInAs(app, prisma, role);
        const response = await placeOrder(browser, orderBody(offer));
        expect(response.status).toBe(403);
        expect(response.body.code).toBe('STAFF_CANNOT_ORDER');
      }
    });

    it('applies the staff role matrix to admin order endpoints', async () => {
      const offer = await product();
      const created = await placeOrder(new TestBrowser(app), orderBody(offer));
      const order = await prisma.order.findUniqueOrThrow({
        where: { orderNumber: created.body.orderNumber },
      });
      const detailPath = `/api/v1/admin/orders/${order.id}`;
      const cancelBody = { reason: 'Pelanggan meminta lewat chat' };

      expect((await new TestBrowser(app).get(detailPath)).status).toBe(401);
      const customer = await signInAs(app, prisma, 'CUSTOMER');
      expect((await customer.browser.get(detailPath)).status).toBe(403);
      expect((await customer.browser.send('post', `${detailPath}/cancel`, cancelBody)).status).toBe(
        403,
      );

      const operator = await signInAs(app, prisma, 'OPERATOR');
      const operatorView = await operator.browser.get(detailPath);
      expect(operatorView.status).toBe(200);
      expect(operatorView.body).toMatchObject({ id: order.id, status: 'PAYMENT_PENDING' });
      const operatorCancel = await operator.browser.send(
        'post',
        `${detailPath}/cancel`,
        cancelBody,
      );
      expect(operatorCancel.status).toBe(403);

      const admin = await signInAs(app, prisma, 'ADMIN');
      expect((await admin.browser.get(detailPath)).status).toBe(200);
      expect((await admin.browser.get(`/api/v1/admin/orders/${randomUUID()}`)).body.code).toBe(
        'ORDER_NOT_FOUND',
      );
    });

    it('does not let a customer cancel another customer order (IDOR)', async () => {
      const offer = await product();
      const alice = await signInAs(app, prisma, 'CUSTOMER');
      const bob = await signInAs(app, prisma, 'CUSTOMER');
      const created = await placeOrder(
        alice.browser,
        orderBody(offer, { contactEmail: undefined }),
      );
      const response = await bob.browser.send(
        'post',
        `/api/v1/me/orders/${created.body.orderId}/cancel`,
      );
      expect(response.status).toBe(404);
      expect(response.body.code).toBe('ORDER_NOT_FOUND');
      const order = await prisma.order.findUniqueOrThrow({ where: { id: created.body.orderId } });
      expect(order.status).toBe('PAYMENT_PENDING');
    });
  });

  describe('cancellation', () => {
    it('lets a customer cancel their unpaid order, once, with history and an outbox event', async () => {
      const offer = await product();
      const { browser } = await signInAs(app, prisma, 'CUSTOMER');
      const created = await placeOrder(browser, orderBody(offer, { contactEmail: undefined }));
      const path = `/api/v1/me/orders/${created.body.orderId}/cancel`;

      const first = await browser.send('post', path);
      expect(first.status).toBe(200);
      expect(first.body.stage).toBe('CANCELLED');
      const again = await browser.send('post', path);
      expect(again.status).toBe(200);
      expect(again.body.stage).toBe('CANCELLED');

      const order = await prisma.order.findUniqueOrThrow({
        where: { id: created.body.orderId },
        include: { statusHistory: true },
      });
      expect(order.status).toBe('CANCELLED');
      expect(order.cancelReason).toBe('CUSTOMER_REQUEST');
      expect(order.cancelledAt).not.toBeNull();
      expect(order.statusHistory.filter((h) => h.toStatus === 'CANCELLED')).toHaveLength(1);
      const events = await prisma.outboxEvent.findMany({ where: { aggregateId: order.id } });
      expect(events.map((e) => e.eventType).sort()).toEqual(['ORDER_CANCELLED', 'ORDER_CREATED']);
    });

    it('requires CSRF protection for customer cancellation', async () => {
      const offer = await product();
      const { browser } = await signInAs(app, prisma, 'CUSTOMER');
      const created = await placeOrder(browser, orderBody(offer, { contactEmail: undefined }));
      const path = `/api/v1/me/orders/${created.body.orderId}/cancel`;
      expect((await browser.send('post', path, undefined, { csrf: false })).status).toBe(403);
      expect(
        (await browser.send('post', path, undefined, { origin: 'https://evil.test' })).status,
      ).toBe(403);
    });

    it('lets a guest cancel with the tracking token only', async () => {
      const offer = await product();
      const created = await placeOrder(new TestBrowser(app), orderBody(offer));
      const other = new TestBrowser(app);
      expect((await other.send('post', `/api/v1/track/${'A'.repeat(43)}/cancel`)).status).toBe(404);
      expect(
        (await other.send('post', `/api/v1/track/${created.body.orderNumber}/cancel`)).status,
      ).toBe(404);

      const response = await other.send(
        'post',
        `/api/v1/track/${created.body.trackingToken}/cancel`,
      );
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ stage: 'CANCELLED', cancellable: false });
    });

    it('refuses to cancel an order once it is paid', async () => {
      const offer = await product();
      const { browser } = await signInAs(app, prisma, 'CUSTOMER');
      const created = await placeOrder(browser, orderBody(offer, { contactEmail: undefined }));
      await prisma.order.update({ where: { id: created.body.orderId }, data: { status: 'PAID' } });
      const response = await browser.send(
        'post',
        `/api/v1/me/orders/${created.body.orderId}/cancel`,
      );
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('ORDER_NOT_CANCELLABLE');
    });

    it('lets an admin cancel with a reason, and audits it once', async () => {
      const offer = await product();
      const created = await placeOrder(new TestBrowser(app), orderBody(offer));
      const order = await prisma.order.findUniqueOrThrow({
        where: { orderNumber: created.body.orderNumber },
      });
      const { user, browser } = await signInAs(app, prisma, 'ADMIN');
      const path = `/api/v1/admin/orders/${order.id}/cancel`;

      expect((await browser.send('post', path, {})).status).toBe(400);
      expect((await browser.send('post', path, { reason: 'ok', extra: true })).status).toBe(400);

      const reason = 'Pesanan ganda dari pelanggan';
      const response = await browser.send('post', path, { reason });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ status: 'CANCELLED', cancelReason: 'STAFF_ACTION' });
      expect((await browser.send('post', path, { reason })).status).toBe(200);

      const audits = await prisma.auditLog.findMany({
        where: { action: 'ORDER_CANCEL', resourceId: order.id },
      });
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        actorUserId: user.id,
        actorRole: 'ADMIN',
        reason,
        before: { status: 'PAYMENT_PENDING' },
        after: { status: 'CANCELLED', cancelReason: 'STAFF_ACTION' },
      });
      const history = await prisma.orderStatusHistory.findFirstOrThrow({
        where: { orderId: order.id, toStatus: 'CANCELLED' },
      });
      expect(history).toMatchObject({ actorType: 'STAFF', actorUserId: user.id, reason });
    });
  });

  describe('payment expiry', () => {
    it('cancels only overdue unpaid orders, and running twice changes nothing more', async () => {
      const offer = await product();
      const overdue = await placeOrder(new TestBrowser(app), orderBody(offer));
      const current = await placeOrder(new TestBrowser(app), orderBody(offer));
      const overdueOrder = await prisma.order.findUniqueOrThrow({
        where: { orderNumber: overdue.body.orderNumber },
      });
      const now = new Date(overdueOrder.paymentExpiresAt!.getTime() + 1000);
      await prisma.order.update({
        where: { orderNumber: current.body.orderNumber },
        data: { paymentExpiresAt: new Date(now.getTime() + 3_600_000) },
      });

      const service = new ExpireUnpaidOrdersService(
        new PrismaOrderStatusTransitionRepository(asPrismaService(prisma)),
      );
      expect(await service.expireDue(now)).toBeGreaterThanOrEqual(1);
      expect(await service.expireDue(now)).toBe(0);

      const expired = await prisma.order.findUniqueOrThrow({
        where: { id: overdueOrder.id },
        include: { statusHistory: true },
      });
      expect(expired).toMatchObject({ status: 'CANCELLED', cancelReason: 'PAYMENT_EXPIRED' });
      const cancellations = expired.statusHistory.filter((h) => h.toStatus === 'CANCELLED');
      expect(cancellations).toHaveLength(1);
      expect(cancellations[0]!.actorType).toBe('SCHEDULER');
      const events = await prisma.outboxEvent.findMany({ where: { aggregateId: expired.id } });
      expect(events.map((e) => e.eventType)).toContain('ORDER_EXPIRED');

      const untouched = await prisma.order.findUniqueOrThrow({
        where: { orderNumber: current.body.orderNumber },
      });
      expect(untouched.status).toBe('PAYMENT_PENDING');
    });
  });

  describe('state machine enforcement', () => {
    it('refuses a transition outside the table before touching the database', async () => {
      const offer = await product();
      const created = await placeOrder(new TestBrowser(app), orderBody(offer));
      const order = await prisma.order.findUniqueOrThrow({
        where: { orderNumber: created.body.orderNumber },
      });
      await prisma.order.update({ where: { id: order.id }, data: { status: 'PAID' } });
      const transitions = new PrismaOrderStatusTransitionRepository(asPrismaService(prisma));
      await expect(
        transitions.apply({
          orderId: order.id,
          from: 'PAID',
          to: 'CANCELLED',
          actorType: 'SYSTEM',
          cancelReason: 'STAFF_ACTION',
          reason: 'not allowed',
        }),
      ).rejects.toMatchObject({ code: 'INVALID_ORDER_TRANSITION' });
      const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(after.status).toBe('PAID');
    });
  });

  describe('request security', () => {
    it('rejects oversized bodies with PAYLOAD_TOO_LARGE', async () => {
      const offer = await product();
      const response = await placeOrder(
        new TestBrowser(app),
        orderBody(offer, { padding: 'x'.repeat(200 * 1024) }),
      );
      expect(response.status).toBe(413);
      expect(response.body.code).toBe('PAYLOAD_TOO_LARGE');
      expect(response.body.requestId).toMatch(/^.{8,128}$/);
      expect(response.headers['x-request-id']).toBe(response.body.requestId);
    });

    it('rejects malformed JSON with the error contract', async () => {
      const response = await new TestBrowser(app).send('post', '/api/v1/orders', '{"productId": ', {
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': newKey() },
      });
      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        code: 'VALIDATION_FAILED',
        message: expect.any(String),
        requestId: expect.any(String),
      });
    });

    it('rejects cross-site order creation', async () => {
      const offer = await product();
      const browser = new TestBrowser(app);
      const response = await browser.send('post', '/api/v1/orders', orderBody(offer), {
        origin: 'https://evil.test',
        headers: { 'Idempotency-Key': newKey() },
      });
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('CSRF_REJECTED');
    });

    it('rate-limits order creation per client', async () => {
      const browser = new TestBrowser(app);
      const statuses: number[] = [];
      for (let i = 0; i < 21; i += 1) {
        statuses.push((await placeOrder(browser, { invalid: true })).status);
      }
      expect(statuses.slice(0, 20).every((s) => s === 400)).toBe(true);
      expect(statuses[20]).toBe(429);
    });
  });
});
