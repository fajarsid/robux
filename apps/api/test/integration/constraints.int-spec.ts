import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '../../src/generated/prisma/client';
import { createOrder, createProductWithPrice, createSource } from './support/fixtures';
import { createTestPrisma, expectDatabaseError } from './support/test-database';

const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
const CHECK_VIOLATION = '23514';
const RESTRICT_VIOLATION = '23001';

describe('database constraints', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrisma();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function newOrder(status?: 'CREATED' | 'PAYMENT_PENDING') {
    const { product, price } = await createProductWithPrice(prisma);
    return createOrder(prisma, { product, price, status });
  }

  describe('order identifiers and idempotency', () => {
    it('rejects a duplicate order number', async () => {
      const first = await newOrder();
      const { product, price } = await createProductWithPrice(prisma);
      const second = await createOrder(prisma, { product, price });
      await expectDatabaseError(
        prisma.order.update({ where: { id: second.id }, data: { orderNumber: first.orderNumber } }),
        { code: UNIQUE_VIOLATION, constraint: 'orders_order_number_key' },
      );
    });

    it('rejects a duplicate guest tracking token hash', async () => {
      const first = await newOrder();
      const second = await newOrder();
      await expectDatabaseError(
        prisma.order.update({
          where: { id: second.id },
          data: { trackingTokenHash: first.trackingTokenHash },
        }),
        { code: UNIQUE_VIOLATION, constraint: 'orders_tracking_token_hash_key' },
      );
    });

    it('rejects a tracking token stored in plaintext instead of as a hash', async () => {
      const order = await newOrder();
      await expectDatabaseError(
        prisma.order.update({
          where: { id: order.id },
          data: { trackingTokenHash: 'x'.repeat(64) },
        }),
        { code: CHECK_VIOLATION, constraint: 'orders_tracking_token_hash_hex' },
      );
    });

    it('rejects a reused order idempotency key', async () => {
      const first = await newOrder();
      const second = await newOrder();
      await expectDatabaseError(
        prisma.order.update({
          where: { id: second.id },
          data: { idempotencyKey: first.idempotencyKey },
        }),
        { code: UNIQUE_VIOLATION, constraint: 'orders_idempotency_key_key' },
      );
    });

    it('rejects a duplicate (scope, key) in idempotency_keys', async () => {
      const key = randomUUID();
      const data = {
        scope: 'orders.create',
        key,
        requestHash: 'a'.repeat(64),
        expiresAt: new Date(Date.now() + 86_400_000),
      };
      await prisma.idempotencyKey.create({ data });
      await expectDatabaseError(prisma.idempotencyKey.create({ data }), {
        code: UNIQUE_VIOLATION,
        constraint: 'idempotency_keys_scope_key_key',
      });
    });
  });

  describe('payments and webhooks', () => {
    it('rejects a duplicate gateway reference for the same gateway', async () => {
      const order = await newOrder('PAYMENT_PENDING');
      const gatewayReference = `DK-${randomUUID()}`;
      const base = {
        orderId: order.id,
        gateway: 'DUITKU' as const,
        amount: order.total,
        currency: 'IDR' as const,
      };
      await prisma.payment.create({
        data: { ...base, merchantOrderId: randomUUID(), gatewayReference },
      });
      await expectDatabaseError(
        prisma.payment.create({
          data: { ...base, merchantOrderId: randomUUID(), gatewayReference },
        }),
        { code: UNIQUE_VIOLATION, constraint: 'payments_gateway_gateway_reference_key' },
      );
    });

    it('allows several payment attempts but only one PAID payment per order', async () => {
      const order = await newOrder('PAYMENT_PENDING');
      const paid = {
        orderId: order.id,
        gateway: 'MOCK' as const,
        amount: order.total,
        currency: 'IDR' as const,
        status: 'PAID' as const,
        paidAt: new Date(),
      };
      await prisma.payment.create({
        data: { ...paid, merchantOrderId: randomUUID(), status: 'EXPIRED', paidAt: null },
      });
      // A PAID payment carries the gateway reference it was verified against (Phase 6 CHECK).
      await prisma.payment.create({
        data: { ...paid, merchantOrderId: randomUUID(), gatewayReference: randomUUID() },
      });
      await expectDatabaseError(
        prisma.payment.create({
          data: { ...paid, merchantOrderId: randomUUID(), gatewayReference: randomUUID() },
        }),
        {
          code: UNIQUE_VIOLATION,
          constraint: 'payments_one_paid_per_order',
        },
      );
    });

    it('rejects fractional rupiah payment amounts', async () => {
      const order = await newOrder('PAYMENT_PENDING');
      await expectDatabaseError(
        prisma.payment.create({
          data: {
            orderId: order.id,
            gateway: 'MOCK',
            merchantOrderId: randomUUID(),
            amount: new Prisma.Decimal('69000.50'),
            currency: 'IDR',
          },
        }),
        { code: CHECK_VIOLATION, constraint: 'payments_idr_whole' },
      );
    });

    it('turns a duplicate webhook delivery into a unique violation', async () => {
      const data = {
        source: 'DUITKU' as const,
        eventKey: `ref-${randomUUID()}:SUCCESS`,
        signatureValid: true,
        payload: {},
        payloadHash: 'b'.repeat(64),
      };
      await prisma.webhookEvent.create({ data });
      await expectDatabaseError(prisma.webhookEvent.create({ data }), {
        code: UNIQUE_VIOLATION,
        constraint: 'webhook_events_source_event_key_key',
      });
    });
  });

  describe('order arithmetic', () => {
    it('rejects a total that does not equal subtotal - discount + fee + tax', async () => {
      const order = await newOrder();
      await expectDatabaseError(
        prisma.order.update({ where: { id: order.id }, data: { total: order.total.add(1) } }),
        { code: CHECK_VIOLATION, constraint: 'orders_total_arithmetic' },
      );
      await expectDatabaseError(
        prisma.order.update({ where: { id: order.id }, data: { tax: 1000 } }),
        { code: CHECK_VIOLATION, constraint: 'orders_total_arithmetic' },
      );
    });

    it('accepts tax when the total includes it', async () => {
      const order = await newOrder();
      const updated = await prisma.order.update({
        where: { id: order.id },
        data: { tax: 1000, total: order.total.add(1000) },
      });
      expect(updated.tax.toString()).toBe('1000');
    });

    it('rejects a discount larger than the subtotal', async () => {
      const order = await newOrder();
      await expectDatabaseError(
        prisma.order.update({
          where: { id: order.id },
          data: { discount: order.subtotal.add(1000), total: new Prisma.Decimal(0) },
        }),
        { code: CHECK_VIOLATION, constraint: 'orders_amounts_non_negative' },
      );
    });

    it('rejects a payment deadline that is not after creation', async () => {
      const order = await newOrder();
      await expectDatabaseError(
        prisma.order.update({
          where: { id: order.id },
          data: { paymentExpiresAt: order.createdAt },
        }),
        { code: CHECK_VIOLATION, constraint: 'orders_payment_deadline_after_creation' },
      );
    });

    it('rejects an order item whose line subtotal is not price x quantity', async () => {
      const order = await newOrder();
      const item = order.items[0]!;
      await expectDatabaseError(
        prisma.orderItem.update({ where: { id: item.id }, data: { quantity: item.quantity + 1 } }),
        { code: CHECK_VIOLATION, constraint: 'order_items_line_arithmetic' },
      );
    });
  });

  describe('foreign keys and delete behaviour', () => {
    it('rejects an order item pointing to a missing price version', async () => {
      const order = await newOrder();
      await expectDatabaseError(
        prisma.orderItem.update({
          where: { id: order.items[0]!.id },
          data: { productPriceId: randomUUID() },
        }),
        { code: FOREIGN_KEY_VIOLATION },
      );
    });

    it('refuses to delete a product that has orders', async () => {
      const { product, price } = await createProductWithPrice(prisma);
      await createOrder(prisma, { product, price });
      await expectDatabaseError(prisma.product.delete({ where: { id: product.id } }), {
        message: /foreign key|violates|restrict|order_items|product_prices/i,
      });
    });

    it('refuses to delete an order that has history', async () => {
      const order = await newOrder();
      await expectDatabaseError(prisma.order.delete({ where: { id: order.id } }), {
        message: /foreign key|violates|restrict/i,
      });
    });
  });

  describe('inventory balances', () => {
    it('never lets a source balance go negative', async () => {
      const source = await createSource(prisma, 100n);
      await expectDatabaseError(
        prisma.fulfillmentSource.update({
          where: { id: source.id },
          data: { availableBalance: { decrement: 101n } },
        }),
        { code: CHECK_VIOLATION, constraint: 'fulfillment_sources_available_non_negative' },
      );
    });

    it('rejects a settled allocation whose consumed + released does not equal the amount', async () => {
      const { product, price } = await createProductWithPrice(prisma);
      const order = await createOrder(prisma, { product, price, status: 'PROCESSING' });
      const source = await createSource(prisma, 1_000n);
      const fulfillmentOrder = await prisma.fulfillmentOrder.create({
        data: { orderId: order.id, method: 'INSTANT', requestedAmount: 500, remainingAmount: 500 },
      });
      const allocation = await prisma.fulfillmentAllocation.create({
        data: {
          fulfillmentOrderId: fulfillmentOrder.id,
          sourceId: source.id,
          amount: 500,
          currency: 'IDR',
          unitCostSnapshot: '95',
        },
      });
      await expectDatabaseError(
        prisma.fulfillmentAllocation.update({
          where: { id: allocation.id },
          data: { status: 'CONSUMED', consumedAmount: 300, settledAt: new Date() },
        }),
        { code: CHECK_VIOLATION, constraint: 'fulfillment_allocations_terminal_fully_settled' },
      );
      await prisma.fulfillmentAllocation.update({
        where: { id: allocation.id },
        data: {
          status: 'CONSUMED',
          consumedAmount: 300,
          releasedAmount: 200,
          settledAt: new Date(),
        },
      });
    });

    it('keeps remaining_amount equal to requested - fulfilled', async () => {
      const order = await newOrder();
      await expectDatabaseError(
        prisma.fulfillmentOrder.create({
          data: {
            orderId: order.id,
            method: 'INSTANT',
            requestedAmount: 1000,
            fulfilledAmount: 700,
            remainingAmount: 1000,
          },
        }),
        { code: CHECK_VIOLATION, constraint: 'fulfillment_orders_remaining_arithmetic' },
      );
    });
  });

  describe('append-only tables', () => {
    it('blocks updating and deleting order status history', async () => {
      const order = await newOrder();
      const row = await prisma.orderStatusHistory.findFirstOrThrow({
        where: { orderId: order.id },
      });
      await expectDatabaseError(
        prisma.orderStatusHistory.update({ where: { id: row.id }, data: { reason: 'rewritten' } }),
        { code: RESTRICT_VIOLATION, message: /append-only/ },
      );
      await expectDatabaseError(prisma.orderStatusHistory.delete({ where: { id: row.id } }), {
        code: RESTRICT_VIOLATION,
        message: /append-only/,
      });
    });

    it('blocks rewriting audit logs, even with TRUNCATE', async () => {
      const log = await prisma.auditLog.create({
        data: {
          actorType: 'SYSTEM',
          action: 'SETTING_CHANGED',
          resourceType: 'system_settings',
          resourceId: 'TEST',
          result: 'SUCCESS',
        },
      });
      await expectDatabaseError(
        prisma.auditLog.update({ where: { id: log.id }, data: { result: 'FAILURE' } }),
        { code: RESTRICT_VIOLATION },
      );
      await expectDatabaseError(prisma.$executeRaw`TRUNCATE audit_logs`, {
        code: RESTRICT_VIOLATION,
      });
    });
  });
});
