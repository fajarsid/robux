import type { PrismaClient } from '../../src/generated/prisma/client';
import { createOrder, createProductWithPrice } from './support/fixtures';
import { createTestPrisma, expectDatabaseError } from './support/test-database';

describe('pricing versioning', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrisma();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('keeps the checkout price on existing orders after the price changes (PRD Scenario H)', async () => {
    const { product, price: v1 } = await createProductWithPrice(prisma, {
      sellingPrice: '70000',
      costPrice: '52000',
    });
    const order = await createOrder(prisma, { product, price: v1, quantity: 2 });

    const v2 = await prisma.productPrice.create({
      data: {
        productId: product.id,
        version: 2,
        sellingPrice: '75000',
        costPrice: '56000',
        currency: 'IDR',
        effectiveFrom: new Date('2026-06-01T00:00:00Z'),
      },
    });

    const stored = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { items: { include: { productPrice: true } } },
    });
    const item = stored.items[0]!;
    expect(item.unitPriceSnapshot.toString()).toBe('70000');
    expect(item.unitCostSnapshot.toString()).toBe('52000');
    expect(item.lineSubtotal.toString()).toBe('140000');
    expect(stored.total.toString()).toBe('140000');
    expect(item.productPriceId).toBe(v1.id);
    expect(item.productPrice.version).toBe(1);

    const active = await prisma.productPrice.findFirstOrThrow({
      where: { productId: product.id, effectiveFrom: { lte: new Date('2026-07-01T00:00:00Z') } },
      orderBy: { effectiveFrom: 'desc' },
    });
    expect(active.id).toBe(v2.id);
  });

  it('rejects editing an existing price version', async () => {
    const { price } = await createProductWithPrice(prisma);
    await expectDatabaseError(
      prisma.productPrice.update({ where: { id: price.id }, data: { sellingPrice: '1000' } }),
      { code: '23001', message: /append-only/ },
    );
  });

  it('rejects deleting a price version', async () => {
    const { price } = await createProductWithPrice(prisma);
    await expectDatabaseError(prisma.productPrice.delete({ where: { id: price.id } }), {
      code: '23001',
    });
  });

  it('rejects two prices with the same version for one product', async () => {
    const { product } = await createProductWithPrice(prisma);
    await expectDatabaseError(
      prisma.productPrice.create({
        data: {
          productId: product.id,
          version: 1,
          sellingPrice: '1000',
          costPrice: '500',
          currency: 'IDR',
          effectiveFrom: new Date(),
        },
      }),
      { code: '23505', constraint: 'product_prices_product_id_version_key' },
    );
  });

  it('rejects fractional rupiah prices', async () => {
    const { product } = await createProductWithPrice(prisma);
    await expectDatabaseError(
      prisma.productPrice.create({
        data: {
          productId: product.id,
          version: 2,
          sellingPrice: '69000.50',
          costPrice: '50000',
          currency: 'IDR',
          effectiveFrom: new Date(),
        },
      }),
      { code: '23514', constraint: 'product_prices_idr_whole' },
    );
  });
});
