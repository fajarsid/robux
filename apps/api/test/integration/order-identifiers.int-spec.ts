import type { PrismaClient } from '../../src/generated/prisma/client';
import { hashGuestTrackingToken } from '../../src/modules/orders/domain/guest-tracking-token';
import { PrismaOrderNumberAllocator } from '../../src/modules/orders/infrastructure/prisma-order-number.allocator';
import { createOrder, createProductWithPrice } from './support/fixtures';
import { asPrismaService, createTestPrisma } from './support/test-database';

describe('order identifiers', () => {
  let prisma: PrismaClient;
  let allocator: PrismaOrderNumberAllocator;

  beforeAll(() => {
    prisma = createTestPrisma();
    allocator = new PrismaOrderNumberAllocator(asPrismaService(prisma));
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('issues distinct, gap-free sequence numbers under concurrency', async () => {
    // A date no other test uses, so the sequence starts at 1.
    const instant = new Date('2030-03-15T05:00:00Z');
    const numbers = await Promise.all(
      Array.from({ length: 40 }, () => allocator.allocate(instant)),
    );

    expect(new Set(numbers).size).toBe(40);
    const sequences = numbers.map((n) => Number(n.split('-')[2])).sort((a, b) => a - b);
    expect(sequences).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
    expect(numbers.every((n) => /^RBX-20300315-\d{5}$/.test(n))).toBe(true);
  });

  it('keeps the public order number, internal id and tracking token unrelated', async () => {
    const { product, price } = await createProductWithPrice(prisma);
    const order = await createOrder(prisma, { product, price });

    expect(order.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(order.orderNumber).toMatch(/^RBX-\d{8}-\d{5,}$/);
    expect(order.trackingTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(order.trackingTokenHash).not.toBe(hashGuestTrackingToken(order.orderNumber));
    expect(order.trackingTokenHash).not.toBe(hashGuestTrackingToken(order.id));
  });

  it('finds an order by the hash of its tracking token', async () => {
    const { product, price } = await createProductWithPrice(prisma);
    const order = await createOrder(prisma, { product, price });
    const found = await prisma.order.findUnique({
      where: { trackingTokenHash: order.trackingTokenHash },
    });
    expect(found?.id).toBe(order.id);
  });
});
