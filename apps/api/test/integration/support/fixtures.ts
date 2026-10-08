import { randomUUID } from 'node:crypto';
import { generateGuestTrackingToken } from '../../../src/modules/orders/domain/guest-tracking-token';
import { PrismaOrderNumberAllocator } from '../../../src/modules/orders/infrastructure/prisma-order-number.allocator';
import { Prisma, type PrismaClient } from '../../../src/generated/prisma/client';
import type { OrderStatus, ProductLine } from '../../../src/generated/prisma/enums';
import { asPrismaService } from './test-database';

/** Tests share one database, so every fixture uses unique keys instead of cleaning up. */
export function uniqueSlug(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

export async function createProductWithPrice(
  prisma: PrismaClient,
  options: {
    robuxAmount?: number;
    sellingPrice?: string;
    costPrice?: string;
    productLine?: ProductLine;
    isActive?: boolean;
  } = {},
) {
  const product = await prisma.product.create({
    data: {
      slug: uniqueSlug('robux'),
      name: 'Test Robux',
      robuxAmount: options.robuxAmount ?? 500,
      fulfillmentMethod: 'INSTANT',
      productLine: options.productLine ?? 'ROBLOX_ROBUX',
      isActive: options.isActive ?? true,
    },
  });
  const price = await prisma.productPrice.create({
    data: {
      productId: product.id,
      version: 1,
      sellingPrice: options.sellingPrice ?? '69000',
      costPrice: options.costPrice ?? '50000',
      currency: 'IDR',
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    },
  });
  return { product, price };
}

/**
 * Builds an order with one item snapshotting `price`, plus the initial NULL → CREATED history
 * row, in one transaction, the way the order engine will (Phase 5).
 */
export async function createOrder(
  prisma: PrismaClient,
  options: {
    product: { id: string; name: string; robuxAmount: number };
    price: { id: string; sellingPrice: Prisma.Decimal; costPrice: Prisma.Decimal };
    quantity?: number;
    status?: OrderStatus;
    /** Product-line snapshot and recipient for non-Robux orders (ADR-009). */
    snapshot?: Pick<
      Prisma.OrderUncheckedCreateInput,
      | 'productLine'
      | 'platform'
      | 'fulfillmentType'
      | 'recipientType'
      | 'recipientUsername'
      | 'recipientRobloxUserId'
    >;
  },
) {
  const quantity = options.quantity ?? 1;
  const allocator = new PrismaOrderNumberAllocator(asPrismaService(prisma));
  const orderNumber = await allocator.allocate(new Date());
  const lineSubtotal = options.price.sellingPrice.mul(quantity);
  const status = options.status ?? 'CREATED';

  return prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        orderNumber,
        trackingTokenHash: generateGuestTrackingToken().hash,
        idempotencyKey: randomUUID(),
        contactEmail: 'guest@example.test',
        status,
        fulfillmentMethod: 'INSTANT',
        currency: 'IDR',
        subtotal: lineSubtotal,
        total: lineSubtotal,
        recipientRobloxUserId: 1_234_567n,
        recipientUsername: 'TestPlayer',
        ...options.snapshot,
        items: {
          create: {
            productId: options.product.id,
            productPriceId: options.price.id,
            productNameSnapshot: options.product.name,
            robuxAmount: options.product.robuxAmount,
            quantity,
            currency: 'IDR',
            unitPriceSnapshot: options.price.sellingPrice,
            unitCostSnapshot: options.price.costPrice,
            lineSubtotal,
          },
        },
      },
      include: { items: true },
    });
    await tx.orderStatusHistory.create({
      data: { orderId: order.id, fromStatus: null, toStatus: status, actorType: 'SYSTEM' },
    });
    return order;
  });
}

export async function createSource(
  prisma: PrismaClient,
  availableBalance: bigint,
  overrides: Partial<Prisma.FulfillmentSourceUncheckedCreateInput> = {},
) {
  return prisma.fulfillmentSource.create({
    data: {
      provider: 'mock',
      name: uniqueSlug('source'),
      status: 'ACTIVE',
      health: 'HEALTHY',
      availableBalance,
      currency: 'IDR',
      ...overrides,
    },
  });
}
