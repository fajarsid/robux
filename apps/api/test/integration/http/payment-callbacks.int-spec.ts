import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import { ExpireUnpaidOrdersService } from '../../../src/modules/orders/application/expire-unpaid-orders.service';
import { PrismaOrderStatusTransitionRepository } from '../../../src/modules/orders/infrastructure/prisma-order-status-transition.repository';
import { DuitkuStub, STUB_API_KEY } from '../support/duitku-stub';
import { createSource } from '../support/fixtures';
import {
  createPaymentsTestApp,
  payAsGuest,
  placeGuestOrder,
  postCallback,
} from '../support/payments-app';
import { asPrismaService, createTestPrisma } from '../support/test-database';

describe('payment callbacks', () => {
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

  /** A guest order with one open Duitku attempt. */
  async function pendingPayment() {
    const placed = await placeGuestOrder(app, prisma);
    const response = await payAsGuest(placed.browser, placed.token);
    expect(response.status).toBe(201);
    const merchantOrderId = `${placed.order.orderNumber}-1`;
    return { ...placed, merchantOrderId };
  }

  async function stateOf(orderId: string, merchantOrderId: string) {
    const [order, payment, history, outbox, cases] = await Promise.all([
      prisma.order.findUniqueOrThrow({ where: { id: orderId } }),
      prisma.payment.findUniqueOrThrow({ where: { merchantOrderId } }),
      prisma.orderStatusHistory.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } }),
      prisma.outboxEvent.findMany({
        where: { aggregateId: orderId },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.reconciliationCase.findMany({ where: { orderId } }),
    ]);
    return { order, payment, history, outbox, cases };
  }

  it('marks the order PAID once Check Transaction confirms the callback', async () => {
    const { order, merchantOrderId } = await pendingPayment();
    stub.settle(merchantOrderId, '00');

    const response = await postCallback(app, stub.callbackForm(merchantOrderId));
    expect(response.status).toBe(200);

    const state = await stateOf(order.id, merchantOrderId);
    expect(state.order.status).toBe('PAID');
    expect(state.order.paidAt).not.toBeNull();
    expect(state.payment).toMatchObject({
      status: 'PAID',
      rawStatus: '00',
      callbackCount: 1,
      gatewayReference: stub.transaction(merchantOrderId).reference,
    });
    expect(state.payment.paidAt).not.toBeNull();
    expect(state.history.at(-1)).toMatchObject({
      fromStatus: 'PAYMENT_PENDING',
      toStatus: 'PAID',
      actorType: 'PAYMENT_GATEWAY',
    });
    expect(state.outbox.map((e) => e.eventType)).toEqual(['ORDER_CREATED', 'PAYMENT_CONFIRMED']);
    expect(state.cases).toEqual([]);
    expect(stub.statusChecks.at(-1)).toMatchObject({ merchantOrderId });

    const event = await prisma.webhookEvent.findFirstOrThrow({
      where: { source: 'DUITKU', eventKey: { startsWith: `${merchantOrderId}:` } },
    });
    expect(event).toMatchObject({ status: 'PROCESSED', signatureValid: true });
    // Signature and customer data are not kept.
    expect(event.payload).not.toHaveProperty('signature');
    expect(event.payload).not.toHaveProperty('customerName');
    expect(event.payload).not.toHaveProperty('merchantUserId');
  });

  it('applies a repeated callback once', async () => {
    const { order, merchantOrderId } = await pendingPayment();
    stub.settle(merchantOrderId, '00');
    const form = stub.callbackForm(merchantOrderId);

    for (let i = 0; i < 3; i += 1) {
      expect((await postCallback(app, form)).status).toBe(200);
    }
    const state = await stateOf(order.id, merchantOrderId);
    expect(state.history.filter((h) => h.toStatus === 'PAID')).toHaveLength(1);
    expect(state.outbox.filter((e) => e.eventType === 'PAYMENT_CONFIRMED')).toHaveLength(1);
    expect(
      await prisma.webhookEvent.count({
        where: { eventKey: { startsWith: `${merchantOrderId}:` } },
      }),
    ).toBe(1);
  });

  it('applies concurrent duplicate callbacks once', async () => {
    const { order, merchantOrderId } = await pendingPayment();
    stub.settle(merchantOrderId, '00');
    const form = stub.callbackForm(merchantOrderId);

    const responses = await Promise.all(Array.from({ length: 5 }, () => postCallback(app, form)));
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    const state = await stateOf(order.id, merchantOrderId);
    expect(state.order.status).toBe('PAID');
    expect(state.history.filter((h) => h.toStatus === 'PAID')).toHaveLength(1);
    expect(state.outbox.filter((e) => e.eventType === 'PAYMENT_CONFIRMED')).toHaveLength(1);
  });

  it('does not trust a success result code the gateway does not confirm', async () => {
    const { order, merchantOrderId } = await pendingPayment();
    // Duitku does not sign resultCode: a replayed form claiming success must change nothing.
    const response = await postCallback(
      app,
      stub.callbackForm(merchantOrderId, { resultCode: '00' }),
    );
    expect(response.status).toBe(200);
    const state = await stateOf(order.id, merchantOrderId);
    expect(state.order.status).toBe('PAYMENT_PENDING');
    expect(state.payment).toMatchObject({ status: 'PENDING', rawStatus: '01' });
  });

  it('rejects a callback with an invalid or missing signature', async () => {
    const { order, merchantOrderId } = await pendingPayment();
    stub.settle(merchantOrderId, '00');
    const checks = stub.statusChecks.length;

    const forged = await postCallback(
      app,
      stub.callbackForm(merchantOrderId, { apiKey: 'not-the-project-key' }),
    );
    expect(forged.status).toBe(401);
    expect(forged.body.code).toBe('WEBHOOK_SIGNATURE_INVALID');
    expect(typeof forged.body.requestId).toBe('string');

    const unsigned = await postCallback(
      app,
      stub.callbackForm(merchantOrderId, { signature: null }),
    );
    expect(unsigned.status).toBe(400);
    expect(unsigned.body.code).toBe('WEBHOOK_PAYLOAD_INVALID');

    expect(stub.statusChecks.length).toBe(checks);
    expect((await stateOf(order.id, merchantOrderId)).order.status).toBe('PAYMENT_PENDING');
    const rejected = await prisma.webhookEvent.findMany({
      where: { signatureValid: false, eventKey: { startsWith: 'rejected:' } },
    });
    expect(rejected.length).toBeGreaterThan(0);
    expect(rejected.every((e) => e.status === 'REJECTED')).toBe(true);
  });

  it('rejects a callback for another merchant even when signed with our key', async () => {
    const { order, merchantOrderId } = await pendingPayment();
    stub.settle(merchantOrderId, '00');
    const response = await postCallback(
      app,
      stub.callbackForm(merchantOrderId, { merchantCode: 'DOTHER' }),
    );
    expect(response.status).toBe(401);
    expect((await stateOf(order.id, merchantOrderId)).order.status).toBe('PAYMENT_PENDING');
  });

  it('rejects a malformed or non-form payload', async () => {
    const json = await request(app.getHttpServer())
      .post('/api/v1/webhooks/payments/duitku')
      .send({ merchantCode: 'DTEST', amount: '1' });
    expect(json.status).toBe(400);
    expect(json.body.code).toBe('WEBHOOK_PAYLOAD_INVALID');

    const { merchantOrderId } = await pendingPayment();
    const badAmount = await postCallback(app, {
      ...stub.callbackForm(merchantOrderId),
      amount: '1e9',
    });
    expect(badAmount.status).toBe(400);
  });

  it('sends a signed callback with a different amount to reconciliation, never PAID', async () => {
    const { order, merchantOrderId } = await pendingPayment();
    stub.settle(merchantOrderId, '00');
    const response = await postCallback(
      app,
      stub.callbackForm(merchantOrderId, { amount: '1000' }),
    );
    expect(response.status).toBe(200);

    const state = await stateOf(order.id, merchantOrderId);
    expect(state.order.status).toBe('RECONCILIATION_REQUIRED');
    expect(state.payment.status).toBe('PENDING');
    expect(state.cases).toHaveLength(1);
    expect(state.cases[0]).toMatchObject({ kind: 'PAYMENT_AMOUNT_MISMATCH', status: 'OPEN' });
    expect(state.history.some((h) => h.toStatus === 'PAID')).toBe(false);
  });

  it('sends a gateway-reported amount mismatch to reconciliation once', async () => {
    const { order, merchantOrderId } = await pendingPayment();
    stub.settle(merchantOrderId, '00');
    stub.reportInstead(merchantOrderId, { amount: '1000' });
    const form = stub.callbackForm(merchantOrderId);
    await postCallback(app, form);
    await postCallback(app, { ...form, resultCode: '01' });

    const state = await stateOf(order.id, merchantOrderId);
    expect(state.order.status).toBe('RECONCILIATION_REQUIRED');
    expect(state.payment.status).toBe('PENDING');
    expect(state.cases).toHaveLength(1);
    const alerts = await prisma.outboxEvent.findMany({
      where: { aggregateId: state.payment.id, eventType: 'PAYMENT_RECONCILIATION_REQUIRED' },
    });
    expect(alerts).toHaveLength(1);
  });

  it('sends a reference that differs from the one we stored to reconciliation', async () => {
    const { order, merchantOrderId } = await pendingPayment();
    stub.settle(merchantOrderId, '00');
    stub.reportInstead(merchantOrderId, { reference: 'DTESTSOMEONEELSE' });
    await postCallback(app, stub.callbackForm(merchantOrderId, { reference: 'DTESTSOMEONEELSE' }));
    const state = await stateOf(order.id, merchantOrderId);
    expect(state.order.status).toBe('RECONCILIATION_REQUIRED');
    expect(state.cases[0]).toMatchObject({ kind: 'PAYMENT_STATUS_MISMATCH' });
  });

  it('acknowledges a correctly signed callback for an unknown payment without applying it', async () => {
    const merchantOrderId = 'RBX-20990101-99999-1';
    const response = await postCallback(app, stub.callbackForm(merchantOrderId));
    expect(response.status).toBe(200);
    const event = await prisma.webhookEvent.findFirstOrThrow({
      where: { eventKey: { startsWith: `${merchantOrderId}:` } },
    });
    expect(event).toMatchObject({ status: 'REJECTED', errorCode: 'UNKNOWN_PAYMENT' });
  });

  it('ignores a failure callback after the order was paid', async () => {
    const { order, merchantOrderId } = await pendingPayment();
    stub.settle(merchantOrderId, '00');
    await postCallback(app, stub.callbackForm(merchantOrderId));
    await postCallback(app, stub.callbackForm(merchantOrderId, { resultCode: '01' }));

    const state = await stateOf(order.id, merchantOrderId);
    expect(state.order.status).toBe('PAID');
    expect(state.payment.status).toBe('PAID');
    expect(state.history.filter((h) => h.toStatus === 'PAID')).toHaveLength(1);
  });

  it('closes a failed attempt and keeps the order open for a new one', async () => {
    const placed = await pendingPayment();
    stub.settle(placed.merchantOrderId, '02');
    await postCallback(app, stub.callbackForm(placed.merchantOrderId, { resultCode: '01' }));

    const state = await stateOf(placed.order.id, placed.merchantOrderId);
    expect(state.payment).toMatchObject({ status: 'FAILED', rawStatus: '02' });
    expect(state.order.status).toBe('PAYMENT_PENDING');
    const retry = await payAsGuest(placed.browser, placed.token, 'SP');
    expect(retry.status).toBe(201);
  });

  it('records money received after expiry for reconciliation without reopening the order', async () => {
    const { order, merchantOrderId } = await pendingPayment();
    await prisma.order.update({
      where: { id: order.id },
      data: {
        createdAt: new Date(Date.now() - 2 * 3_600_000),
        paymentExpiresAt: new Date(Date.now() - 1000),
      },
    });
    const expiry = new ExpireUnpaidOrdersService(
      new PrismaOrderStatusTransitionRepository(asPrismaService(prisma)),
    );
    await expiry.expireDue();
    stub.settle(merchantOrderId, '00');

    expect((await postCallback(app, stub.callbackForm(merchantOrderId))).status).toBe(200);
    const state = await stateOf(order.id, merchantOrderId);
    expect(state.order.status).toBe('CANCELLED');
    expect(state.payment.status).toBe('PAID');
    expect(state.cases).toHaveLength(1);
    expect(state.cases[0]).toMatchObject({ kind: 'PAYMENT_STATUS_MISMATCH' });
    expect(state.cases[0]!.evidence).toMatchObject({ reason: 'ORDER_NOT_AWAITING_PAYMENT' });
    expect(state.outbox.some((e) => e.eventType === 'PAYMENT_CONFIRMED')).toBe(false);
  });

  describe('late payment for a closed order', () => {
    /** The order must stay closed and nothing may lead towards fulfillment. */
    async function expectReconciledNotFulfilled(orderId: string, merchantOrderId: string) {
      const state = await stateOf(orderId, merchantOrderId);
      expect(state.order.status).toBe('CANCELLED');
      expect(state.payment.status).toBe('PAID');
      expect(state.history.some((h) => h.toStatus === 'PAID')).toBe(false);
      expect(state.cases).toHaveLength(1);
      expect(state.cases[0]!.evidence).toMatchObject({ reason: 'ORDER_NOT_AWAITING_PAYMENT' });
      expect(state.outbox.some((e) => e.eventType === 'PAYMENT_CONFIRMED')).toBe(false);
      expect(
        await prisma.outboxEvent.count({
          where: { aggregateId: state.payment.id, eventType: 'PAYMENT_RECONCILIATION_REQUIRED' },
        }),
      ).toBe(1);
      expect(await prisma.fulfillmentOrder.count({ where: { orderId } })).toBe(0);
    }

    it('records a payment for an order the customer cancelled without reopening it', async () => {
      const { order, merchantOrderId, browser, token } = await pendingPayment();
      expect((await browser.send('post', `/api/v1/track/${token}/cancel`)).status).toBe(200);
      stub.settle(merchantOrderId, '00');

      expect((await postCallback(app, stub.callbackForm(merchantOrderId))).status).toBe(200);
      await expectReconciledNotFulfilled(order.id, merchantOrderId);
    });

    it('records a repeated late callback once', async () => {
      const { order, merchantOrderId, browser, token } = await pendingPayment();
      await browser.send('post', `/api/v1/track/${token}/cancel`);
      stub.settle(merchantOrderId, '00');
      const form = stub.callbackForm(merchantOrderId);

      for (let i = 0; i < 3; i += 1) {
        expect((await postCallback(app, form)).status).toBe(200);
      }
      await expectReconciledNotFulfilled(order.id, merchantOrderId);
    });

    it('records concurrent late callbacks once', async () => {
      const { order, merchantOrderId, browser, token } = await pendingPayment();
      await browser.send('post', `/api/v1/track/${token}/cancel`);
      stub.settle(merchantOrderId, '00');
      const form = stub.callbackForm(merchantOrderId);

      const responses = await Promise.all(Array.from({ length: 5 }, () => postCallback(app, form)));
      expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
      await expectReconciledNotFulfilled(order.id, merchantOrderId);
    });
  });

  it('never leaves an order both paid and expired when expiry and callback race', async () => {
    for (let round = 0; round < 3; round += 1) {
      const { order, merchantOrderId } = await pendingPayment();
      stub.settle(merchantOrderId, '00');
      await prisma.order.update({
        where: { id: order.id },
        data: {
          createdAt: new Date(Date.now() - 2 * 3_600_000),
          paymentExpiresAt: new Date(Date.now() - 1000),
        },
      });
      const expiry = new ExpireUnpaidOrdersService(
        new PrismaOrderStatusTransitionRepository(asPrismaService(prisma)),
      );
      await Promise.all([
        expiry.expireDue(),
        postCallback(app, stub.callbackForm(merchantOrderId)),
      ]);
      const state = await stateOf(order.id, merchantOrderId);
      expect(state.payment.status).toBe('PAID');
      if (state.order.status === 'PAID') {
        expect(state.cases).toHaveLength(0);
      } else {
        expect(state.order.status).toBe('CANCELLED');
        expect(state.cases).toHaveLength(1);
      }
      expect(state.history.filter((h) => h.fromStatus === 'PAYMENT_PENDING')).toHaveLength(1);
    }
  });

  it('asks Duitku to retry when the status cannot be verified', async () => {
    const { order, merchantOrderId } = await pendingPayment();
    stub.settle(merchantOrderId, '00');
    const form = stub.callbackForm(merchantOrderId);
    stub.failStatusChecks({ kind: 'network' });
    try {
      const response = await postCallback(app, form);
      expect(response.status).toBe(503);
      expect(response.body.code).toBe('PAYMENT_GATEWAY_UNAVAILABLE');
      expect((await stateOf(order.id, merchantOrderId)).order.status).toBe('PAYMENT_PENDING');
    } finally {
      stub.failStatusChecks(null);
    }
    expect((await postCallback(app, form)).status).toBe(200);
    expect((await stateOf(order.id, merchantOrderId)).order.status).toBe('PAID');
  });

  it('never echoes secrets or gateway internals in callback errors', async () => {
    const { merchantOrderId } = await pendingPayment();
    const response = await postCallback(
      app,
      stub.callbackForm(merchantOrderId, { apiKey: 'wrong' }),
    );
    const text = JSON.stringify(response.body);
    expect(Object.keys(response.body).sort()).toEqual(['code', 'message', 'requestId']);
    expect(text).not.toContain(STUB_API_KEY);
    expect(text).not.toContain('signature');
  });
});

describe('payment callbacks with a source allow-list', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  const stub = new DuitkuStub();

  beforeAll(async () => {
    app = await createPaymentsTestApp(stub, { DUITKU_CALLBACK_ALLOWED_IPS: '182.23.85.11' });
    prisma = createTestPrisma();
    // Modest stock: suites share one database and others assert OUT_OF_STOCK thresholds.
    await createSource(prisma, 1_000_000n);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('accepts the listed Duitku address and refuses others', async () => {
    const placed = await placeGuestOrder(app, prisma);
    await payAsGuest(placed.browser, placed.token);
    const merchantOrderId = `${placed.order.orderNumber}-1`;
    stub.settle(merchantOrderId, '00');
    const form = stub.callbackForm(merchantOrderId);

    const outsider = await request(app.getHttpServer())
      .post('/api/v1/webhooks/payments/duitku')
      .set('X-Forwarded-For', '198.51.100.7')
      .type('form')
      .send(form);
    expect(outsider.status).toBe(403);

    expect((await postCallback(app, form)).status).toBe(200);
  });
});
