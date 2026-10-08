import type { NestExpressApplication } from '@nestjs/platform-express';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import { DuitkuStub, STUB_API_KEY, STUB_MERCHANT_CODE } from '../support/duitku-stub';
import { duitkuSignature } from '../../../src/modules/payments/infrastructure/duitku/duitku-signature';
import { createOrder, createProductWithPrice, createSource } from '../support/fixtures';
import {
  createPaymentsTestApp,
  ENABLED_METHODS,
  newKey,
  payAsGuest,
  placeGuestOrder,
} from '../support/payments-app';
import { createTestApp, signInAs, TestBrowser } from '../support/test-app';
import { createTestPrisma } from '../support/test-database';

const MINUTE = 60_000;

describe('payment creation', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  const stub = new DuitkuStub();

  beforeAll(async () => {
    app = await createPaymentsTestApp(stub);
    prisma = createTestPrisma();
    // Modest stock: suites share one database and others assert OUT_OF_STOCK thresholds.
    await createSource(prisma, 1_000_000n);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('lists only the enabled payment method codes', async () => {
    const response = await new TestBrowser(app).get('/api/v1/payments/methods');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ methods: ENABLED_METHODS.map((code) => ({ code })) });
  });

  it('opens a Duitku transaction for the stored order total, never a client amount', async () => {
    const { browser, order, token } = await placeGuestOrder(app, prisma);
    const before = Date.now();
    const response = await payAsGuest(browser, token);

    expect(response.status).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toMatchObject({
      status: 'PENDING',
      paymentMethod: 'BC',
      amount: '138000.00',
      currency: 'IDR',
      paidAt: null,
    });
    expect(response.body.paymentUrl).toMatch(/^https:\/\/sandbox\.duitku\.com\//);
    expect(response.body).not.toHaveProperty('merchantOrderId');
    expect(response.body).not.toHaveProperty('gatewayReference');

    const inquiry = stub.inquiries.at(-1)!;
    const merchantOrderId = `${order.orderNumber}-1`;
    expect(inquiry).toMatchObject({
      merchantCode: STUB_MERCHANT_CODE,
      paymentAmount: 138000,
      paymentMethod: 'BC',
      merchantOrderId,
      email: 'guest@example.test',
      customerVaName: order.orderNumber,
      itemDetails: [{ price: 138000, quantity: 1 }],
      callbackUrl: 'http://api.test/api/v1/webhooks/payments/duitku',
      returnUrl: 'http://app.test/payment/return',
      signature: duitkuSignature(STUB_API_KEY, STUB_MERCHANT_CODE, merchantOrderId, '138000'),
    });
    // The attempt closes 5 minutes before the order deadline (default window 60 minutes).
    const allowed = Math.floor((order.paymentExpiresAt!.getTime() - 5 * MINUTE - before) / MINUTE);
    expect(inquiry.expiryPeriod).toBeLessThanOrEqual(allowed);
    expect(inquiry.expiryPeriod).toBeGreaterThanOrEqual(allowed - 1);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { merchantOrderId } });
    expect(payment).toMatchObject({
      orderId: order.id,
      gateway: 'DUITKU',
      status: 'PENDING',
      currency: 'IDR',
      paymentMethodCode: 'BC',
      gatewayReference: stub.transaction(merchantOrderId).reference,
    });
    expect(payment.amount.toString()).toBe(order.total.toString());
    expect(payment.expiresAt!.getTime()).toBeLessThanOrEqual(
      order.paymentExpiresAt!.getTime() - 5 * MINUTE,
    );
  });

  it('rejects amounts, unknown fields and malformed method codes in the body', async () => {
    const { browser, order, token } = await placeGuestOrder(app, prisma);
    for (const body of [
      { paymentMethod: 'BC', amount: '1000' },
      { paymentMethod: 'BC', total: 1 },
      { paymentMethod: 'bca' },
      {},
    ]) {
      const response = await browser.send('post', `/api/v1/track/${token}/payment`, body, {
        headers: { 'Idempotency-Key': newKey() },
      });
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_FAILED');
    }
    expect(await prisma.payment.count({ where: { orderId: order.id } })).toBe(0);
  });

  it('refuses a method that is not enabled', async () => {
    const { browser, token } = await placeGuestOrder(app, prisma);
    const response = await payAsGuest(browser, token, 'VC');
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('PAYMENT_METHOD_UNAVAILABLE');
  });

  it('refuses a method whose fixed gateway window outlasts the order', async () => {
    const { browser, order, token } = await placeGuestOrder(app, prisma);
    // LinkAja keeps its fixed 24-minute window; with 20 minutes left it could be paid too late.
    await prisma.order.update({
      where: { id: order.id },
      data: { paymentExpiresAt: new Date(Date.now() + 25 * MINUTE) },
    });
    const response = await payAsGuest(browser, token, 'LF');
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('PAYMENT_METHOD_UNAVAILABLE');
    expect(await prisma.payment.findFirst({ where: { orderId: order.id } })).toMatchObject({
      status: 'FAILED',
    });
  });

  it('requires a well-formed Idempotency-Key', async () => {
    const { browser, token } = await placeGuestOrder(app, prisma);
    for (const key of [null, 'short', 'not valid key with spaces!!']) {
      const response = await payAsGuest(browser, token, 'BC', key);
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    }
  });

  it('replays a retried request and refuses the key for a different method', async () => {
    const { browser, order, token } = await placeGuestOrder(app, prisma);
    const key = newKey();
    const first = await payAsGuest(browser, token, 'BC', key);
    const retry = await payAsGuest(browser, token, 'BC', key);
    expect(retry.status).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.body).toEqual(first.body);

    const other = await payAsGuest(browser, token, 'SP', key);
    expect(other.status).toBe(422);
    expect(other.body.code).toBe('DUPLICATE_IDEMPOTENCY_KEY');
    expect(await prisma.payment.count({ where: { orderId: order.id } })).toBe(1);
  });

  it('returns the live attempt to a double click and refuses a second live attempt', async () => {
    const { browser, order, token } = await placeGuestOrder(app, prisma);
    const first = await payAsGuest(browser, token, 'BC');
    const again = await payAsGuest(browser, token, 'BC');
    expect(again.status).toBe(200);
    expect(again.body.paymentUrl).toBe(first.body.paymentUrl);

    const switching = await payAsGuest(browser, token, 'SP');
    expect(switching.status).toBe(409);
    expect(switching.body.code).toBe('PAYMENT_ALREADY_PENDING');
    expect(await prisma.payment.count({ where: { orderId: order.id } })).toBe(1);
  });

  it('opens exactly one attempt for concurrent requests', async () => {
    const { browser, order, token } = await placeGuestOrder(app, prisma);
    const responses = await Promise.all(
      Array.from({ length: 6 }, () => payAsGuest(browser, token, 'BC')),
    );
    for (const response of responses) {
      expect([200, 201, 409]).toContain(response.status);
      if (response.status === 409) {
        expect(response.body.code).toBe('PAYMENT_IN_PROGRESS');
      }
    }
    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await prisma.payment.count({ where: { orderId: order.id } })).toBe(1);
  });

  it('allows a new attempt after the previous one closed, keeping its history', async () => {
    const { browser, order, token } = await placeGuestOrder(app, prisma);
    await payAsGuest(browser, token, 'BC');
    await prisma.payment.updateMany({
      where: { orderId: order.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const second = await payAsGuest(browser, token, 'SP');
    expect(second.status).toBe(201);
    const attempts = await prisma.payment.findMany({
      where: { orderId: order.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(attempts.map((a) => [a.merchantOrderId, a.status])).toEqual([
      [`${order.orderNumber}-1`, 'EXPIRED'],
      [`${order.orderNumber}-2`, 'PENDING'],
    ]);
  });

  it('refuses orders that are cancelled or too close to their deadline', async () => {
    const cancelled = await placeGuestOrder(app, prisma);
    await cancelled.browser.send('post', `/api/v1/track/${cancelled.token}/cancel`);
    const refused = await payAsGuest(cancelled.browser, cancelled.token);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('ORDER_NOT_PAYABLE');

    const late = await placeGuestOrder(app, prisma);
    await prisma.order.update({
      where: { id: late.order.id },
      data: { paymentExpiresAt: new Date(Date.now() + 8 * MINUTE) },
    });
    const tooLate = await payAsGuest(late.browser, late.token);
    expect(tooLate.status).toBe(409);
    expect(tooLate.body.code).toBe('ORDER_NOT_PAYABLE');
    expect(
      stub.inquiries.some((i) => String(i.merchantOrderId).startsWith(late.order.orderNumber)),
    ).toBe(false);
  });

  it('marks the attempt failed when the gateway is down and lets the customer retry', async () => {
    const { browser, order, token } = await placeGuestOrder(app, prisma);
    stub.failInquiries({ kind: 'http', status: 503 });
    try {
      const down = await payAsGuest(browser, token);
      expect(down.status).toBe(503);
      expect(down.body.code).toBe('PAYMENT_GATEWAY_UNAVAILABLE');
      expect(JSON.stringify(down.body)).not.toContain(STUB_API_KEY);

      stub.failInquiries({ kind: 'http', status: 404 });
      const refused = await payAsGuest(browser, token);
      expect(refused.status).toBe(502);
      expect(refused.body.code).toBe('PAYMENT_GATEWAY_REJECTED');
    } finally {
      stub.failInquiries(null);
    }
    const retry = await payAsGuest(browser, token);
    expect(retry.status).toBe(201);
    const statuses = await prisma.payment.findMany({
      where: { orderId: order.id },
      orderBy: { createdAt: 'asc' },
      select: { status: true, rawStatus: true },
    });
    expect(statuses).toEqual([
      { status: 'FAILED', rawStatus: 'CREATION_FAILED' },
      { status: 'FAILED', rawStatus: 'CREATION_FAILED' },
      { status: 'PENDING', rawStatus: null },
    ]);
  });

  it('enforces CSRF origin checks on payment creation', async () => {
    const { browser, token } = await placeGuestOrder(app, prisma);
    const response = await browser.send(
      'post',
      `/api/v1/track/${token}/payment`,
      {
        paymentMethod: 'BC',
      },
      { origin: 'https://evil.example', headers: { 'Idempotency-Key': newKey() } },
    );
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('CSRF_REJECTED');
  });

  it('rate-limits payment creation per IP', async () => {
    const browser = new TestBrowser(app);
    const statuses: number[] = [];
    for (let i = 0; i < 21; i += 1) {
      const response = await browser.send(
        'post',
        '/api/v1/track/not-a-token/payment',
        {},
        {
          headers: { 'Idempotency-Key': newKey() },
        },
      );
      statuses.push(response.status);
    }
    expect(statuses.slice(0, 20).every((status) => status !== 429)).toBe(true);
    expect(statuses[20]).toBe(429);
  });

  describe('access', () => {
    it('lets a customer pay and read their own order only', async () => {
      const owner = await signInAs(app, prisma, 'CUSTOMER');
      const other = await signInAs(app, prisma, 'CUSTOMER');
      const offer = await createProductWithPrice(prisma);
      const created = await owner.browser.send(
        'post',
        '/api/v1/orders',
        {
          productId: offer.product.id,
          priceVersionId: offer.price.id,
          quantity: 1,
          recipient: { robloxUsername: 'Builder_Kid' },
        },
        { headers: { 'Idempotency-Key': newKey() } },
      );
      const orderId = created.body.orderId as string;
      const path = `/api/v1/me/orders/${orderId}/payment`;

      const none = await owner.browser.get(path);
      expect(none.status).toBe(404);
      expect(none.body.code).toBe('PAYMENT_NOT_FOUND');

      const foreign = await other.browser.send(
        'post',
        path,
        { paymentMethod: 'BC' },
        {
          headers: { 'Idempotency-Key': newKey() },
        },
      );
      expect(foreign.status).toBe(404);
      expect(foreign.body.code).toBe('ORDER_NOT_FOUND');

      const paid = await owner.browser.send(
        'post',
        path,
        { paymentMethod: 'BC' },
        {
          headers: { 'Idempotency-Key': newKey() },
        },
      );
      expect(paid.status).toBe(201);
      expect((await owner.browser.get(path)).body).toMatchObject({ status: 'PENDING' });
      expect((await other.browser.get(path)).status).toBe(404);
      expect((await new TestBrowser(app).get(path)).status).toBe(401);
    });

    it('lets a guest reach the payment only with the tracking token', async () => {
      const { browser, order, token } = await placeGuestOrder(app, prisma);
      await payAsGuest(browser, token);

      const status = await new TestBrowser(app).get(`/api/v1/track/${token}/payment`);
      expect(status.status).toBe(200);
      expect(status.headers['referrer-policy']).toBe('no-referrer');
      expect(status.body).toMatchObject({ status: 'PENDING', amount: '138000.00' });

      for (const guess of [order.orderNumber, order.id, order.trackingTokenHash, 'x'.repeat(43)]) {
        const response = await new TestBrowser(app).get(`/api/v1/track/${guess}/payment`);
        expect(response.status).toBe(404);
        expect(response.body.code).toBe('ORDER_NOT_FOUND');
      }
    });

    it('refuses staff sessions on customer payment routes', async () => {
      const staff = await signInAs(app, prisma, 'ADMIN');
      const response = await staff.browser.send(
        'post',
        '/api/v1/me/orders/00000000-0000-7000-8000-000000000000/payment',
        { paymentMethod: 'BC' },
        { headers: { 'Idempotency-Key': newKey() } },
      );
      expect(response.status).toBe(403);
    });
  });
});

describe('payment intake switched off', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = createTestPrisma();
    // Modest stock: suites share one database and others assert OUT_OF_STOCK thresholds.
    await createSource(prisma, 1_000_000n);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('offers no methods, refuses payment and has no callback endpoint', async () => {
    expect((await new TestBrowser(app).get('/api/v1/payments/methods')).body).toEqual({
      methods: [],
    });
    const { browser, token } = await placeGuestOrder(app, prisma);
    const response = await payAsGuest(browser, token);
    expect(response.status).toBe(503);
    expect(response.body.code).toBe('PAYMENT_GATEWAY_UNAVAILABLE');
    const callback = await new TestBrowser(app).send(
      'post',
      '/api/v1/webhooks/payments/duitku',
      'merchantCode=x',
      { origin: null },
    );
    expect(callback.status).toBe(404);
  });
});

describe('payment constraints', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrisma();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function orderFixture() {
    const offer = await createProductWithPrice(prisma);
    return createOrder(prisma, { ...offer, status: 'PAYMENT_PENDING' });
  }

  function attempt(
    orderId: string,
    merchantOrderId: string,
    status: 'PENDING' | 'FAILED' = 'PENDING',
  ) {
    return prisma.payment.create({
      data: {
        orderId,
        gateway: 'DUITKU',
        merchantOrderId,
        amount: '69000',
        currency: 'IDR',
        status,
      },
    });
  }

  it('allows one PENDING attempt per order, any number of closed ones', async () => {
    const order = await orderFixture();
    await attempt(order.id, `${order.orderNumber}-1`, 'FAILED');
    await attempt(order.id, `${order.orderNumber}-2`);
    await expect(attempt(order.id, `${order.orderNumber}-3`)).rejects.toMatchObject({
      code: 'P2002',
    });
  });

  it('requires a gateway reference on a PAID payment', async () => {
    const order = await orderFixture();
    await expect(
      prisma.payment.create({
        data: {
          orderId: order.id,
          gateway: 'DUITKU',
          merchantOrderId: `${order.orderNumber}-1`,
          amount: '69000',
          currency: 'IDR',
          status: 'PAID',
          paidAt: new Date(),
        },
      }),
    ).rejects.toThrow(/payments_paid_has_reference/);
  });
});
