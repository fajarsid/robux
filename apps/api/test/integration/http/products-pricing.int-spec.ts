import type { NestExpressApplication } from '@nestjs/platform-express';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import { createOrder, createSource, uniqueSlug } from '../support/fixtures';
import { createTestApp, signInAs, TestBrowser } from '../support/test-app';
import { createTestPrisma } from '../support/test-database';

describe('products and pricing', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let admin: TestBrowser;
  let superAdmin: TestBrowser;
  let operator: TestBrowser;
  let customer: TestBrowser;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = createTestPrisma();
    await createSource(prisma, 1_000_000n);
    admin = (await signInAs(app, prisma, 'ADMIN')).browser;
    superAdmin = (await signInAs(app, prisma, 'SUPER_ADMIN')).browser;
    operator = (await signInAs(app, prisma, 'OPERATOR')).browser;
    customer = (await signInAs(app, prisma, 'CUSTOMER')).browser;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  function productRequest(overrides: Record<string, unknown> = {}) {
    return {
      slug: uniqueSlug('robux'),
      name: 'Robux 750',
      robuxAmount: 750,
      fulfillmentMethod: 'INSTANT',
      minQuantity: 1,
      maxQuantity: 10,
      displayOrder: 5,
      initialPrice: { sellingPrice: '99000', costPrice: '75000' },
      ...overrides,
    };
  }

  async function createActiveProduct(overrides: Record<string, unknown> = {}) {
    const created = await admin.send('post', '/api/v1/admin/products', productRequest(overrides));
    expect(created.status).toBe(201);
    const activated = await admin.send(
      'post',
      `/api/v1/admin/products/${created.body.id}/activate`,
    );
    expect(activated.status).toBe(200);
    return activated.body;
  }

  describe('authorization', () => {
    it('lets ADMIN and SUPER_ADMIN create products, and denies OPERATOR and CUSTOMER', async () => {
      expect((await admin.send('post', '/api/v1/admin/products', productRequest())).status).toBe(
        201,
      );
      expect(
        (await superAdmin.send('post', '/api/v1/admin/products', productRequest())).status,
      ).toBe(201);
      expect((await operator.send('post', '/api/v1/admin/products', productRequest())).status).toBe(
        403,
      );
      expect((await customer.send('post', '/api/v1/admin/products', productRequest())).status).toBe(
        403,
      );
      expect(
        (await new TestBrowser(app).send('post', '/api/v1/admin/products', productRequest()))
          .status,
      ).toBe(401);
    });

    it('denies price and status changes to OPERATOR and CUSTOMER', async () => {
      const product = await createActiveProduct();
      const priceChange = { sellingPrice: '100000', costPrice: '75000', basedOnVersion: 1 };
      for (const browser of [operator, customer]) {
        expect(
          (await browser.send('post', `/api/v1/admin/products/${product.id}/prices`, priceChange))
            .status,
        ).toBe(403);
        expect(
          (await browser.send('post', `/api/v1/admin/products/${product.id}/deactivate`)).status,
        ).toBe(403);
        expect(
          (await browser.send('patch', `/api/v1/admin/products/${product.id}`, { name: 'Hacked' }))
            .status,
        ).toBe(403);
      }
      const unchanged = await admin.get(`/api/v1/admin/products/${product.id}`);
      expect(unchanged.body).toMatchObject({ isActive: true, latestVersion: 1, name: 'Robux 750' });
    });

    it('lets OPERATOR read products without cost data; ADMIN sees costs', async () => {
      const product = await createActiveProduct();
      const asOperator = await operator.get(`/api/v1/admin/products/${product.id}`);
      expect(asOperator.status).toBe(200);
      expect(asOperator.body.currentPrice).not.toHaveProperty('costPrice');
      expect(asOperator.body.prices[0]).not.toHaveProperty('margin');
      const asAdmin = await admin.get(`/api/v1/admin/products/${product.id}`);
      expect(asAdmin.body.currentPrice).toMatchObject({
        costPrice: '75000.00',
        margin: '24000.00',
      });
      expect((await customer.get('/api/v1/admin/products')).status).toBe(403);
    });
  });

  describe('product lifecycle', () => {
    it('creates products inactive with price version 1, and audits the creation', async () => {
      const response = await admin.send('post', '/api/v1/admin/products', productRequest());
      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ isActive: false, latestVersion: 1 });
      expect(response.body.prices).toHaveLength(1);
      expect(response.body.prices[0]).toMatchObject({
        version: 1,
        status: 'ACTIVE',
        sellingPrice: '99000.00',
      });
      const audit = await prisma.auditLog.findFirst({
        where: { action: 'PRODUCT_CREATED', resourceId: response.body.id },
      });
      expect(audit?.after).toMatchObject({ robuxAmount: 750, sellingPrice: '99000.00' });
    });

    it('rejects duplicate slugs, invalid limits and unconfirmed below-cost prices', async () => {
      const request = productRequest();
      await admin.send('post', '/api/v1/admin/products', request);
      const duplicate = await admin.send('post', '/api/v1/admin/products', request);
      expect(duplicate.status).toBe(409);

      const limits = await admin.send(
        'post',
        '/api/v1/admin/products',
        productRequest({ minQuantity: 5, maxQuantity: 2 }),
      );
      expect(limits.status).toBe(400);

      const belowCost = productRequest({
        initialPrice: { sellingPrice: '50000', costPrice: '75000' },
      });
      const rejected = await admin.send('post', '/api/v1/admin/products', belowCost);
      expect(rejected.status).toBe(400);
      expect(rejected.body.code).toBe('PRICING_RULE_VIOLATION');
      const confirmed = await admin.send(
        'post',
        '/api/v1/admin/products',
        productRequest({
          initialPrice: { sellingPrice: '50000', costPrice: '75000', confirmBelowCost: true },
        }),
      );
      expect(confirmed.status).toBe(201);
    });

    it('shows active products in the catalog and hides them again when deactivated', async () => {
      const product = await createActiveProduct();
      const listed = await new TestBrowser(app).get('/api/v1/products');
      expect(listed.body.map((p: { slug: string }) => p.slug)).toContain(product.slug);

      const deactivated = await admin.send(
        'post',
        `/api/v1/admin/products/${product.id}/deactivate`,
      );
      expect(deactivated.body.isActive).toBe(false);
      const after = await new TestBrowser(app).get('/api/v1/products');
      expect(after.body.map((p: { slug: string }) => p.slug)).not.toContain(product.slug);
      expect((await new TestBrowser(app).get(`/api/v1/products/${product.slug}`)).status).toBe(404);
      expect(
        (await new TestBrowser(app).get(`/api/v1/products/${product.slug}/quote?quantity=1`))
          .status,
      ).toBe(404);

      const actions = (
        await prisma.auditLog.findMany({
          where: { resourceId: product.id },
          orderBy: { createdAt: 'asc' },
        })
      ).map((a) => a.action);
      expect(actions).toEqual(['PRODUCT_CREATED', 'PRODUCT_ACTIVATED', 'PRODUCT_DEACTIVATED']);
    });

    it('refuses to activate a product without a price in force', async () => {
      const product = await prisma.product.create({
        data: {
          slug: uniqueSlug('future'),
          name: 'Future priced',
          robuxAmount: 100,
          fulfillmentMethod: 'INSTANT',
          prices: {
            create: {
              version: 1,
              sellingPrice: '20000',
              costPrice: '15000',
              currency: 'IDR',
              effectiveFrom: new Date(Date.now() + 86_400_000),
            },
          },
        },
      });
      const response = await admin.send('post', `/api/v1/admin/products/${product.id}/activate`);
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('INVALID_PRODUCT_STATE');
    });

    it('reports products the stock cannot cover as OUT_OF_STOCK', async () => {
      const product = await createActiveProduct({
        robuxAmount: 1_000_000,
        minQuantity: 100,
        maxQuantity: 100,
      });
      const listed = await new TestBrowser(app).get(`/api/v1/products/${product.slug}`);
      expect(listed.body.availability).toBe('OUT_OF_STOCK');
      const normal = await createActiveProduct();
      expect(
        (await new TestBrowser(app).get(`/api/v1/products/${normal.slug}`)).body.availability,
      ).toBe('AVAILABLE');
    });
  });

  describe('versioned pricing', () => {
    it('appends a new version, supersedes the old one and keeps it unchanged', async () => {
      const product = await createActiveProduct();
      const v2 = await admin.send('post', `/api/v1/admin/products/${product.id}/prices`, {
        sellingPrice: '105000',
        costPrice: '76000',
        basedOnVersion: 1,
      });
      expect(v2.status).toBe(201);
      expect(
        v2.body.prices.map((p: { version: number; status: string; sellingPrice: string }) => [
          p.version,
          p.status,
          p.sellingPrice,
        ]),
      ).toEqual([
        [2, 'ACTIVE', '105000.00'],
        [1, 'SUPERSEDED', '99000.00'],
      ]);
      const audit = await prisma.auditLog.findFirst({
        where: { action: 'PRICE_CHANGED', resourceId: product.id },
      });
      expect(audit).toMatchObject({
        before: { version: 1, sellingPrice: '99000.00' },
        after: { version: 2, sellingPrice: '105000.00' },
      });
    });

    it('rejects a stale or repeated change (no lost updates, no double submit)', async () => {
      const product = await createActiveProduct();
      const change = { sellingPrice: '101000', costPrice: '75000', basedOnVersion: 1 };
      expect(
        (await admin.send('post', `/api/v1/admin/products/${product.id}/prices`, change)).status,
      ).toBe(201);
      const repeated = await admin.send(
        'post',
        `/api/v1/admin/products/${product.id}/prices`,
        change,
      );
      expect(repeated.status).toBe(409);
      expect(repeated.body.code).toBe('PRICE_VERSION_CONFLICT');
      expect(await prisma.productPrice.count({ where: { productId: product.id } })).toBe(2);
    });

    it('schedules future prices without changing the active one, and refuses backdating', async () => {
      const product = await createActiveProduct();
      const scheduled = await admin.send('post', `/api/v1/admin/products/${product.id}/prices`, {
        sellingPrice: '120000',
        costPrice: '80000',
        basedOnVersion: 1,
        effectiveFrom: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      });
      expect(scheduled.body.currentPrice).toMatchObject({ version: 1, sellingPrice: '99000.00' });
      expect(scheduled.body.prices[0]).toMatchObject({ version: 2, status: 'SCHEDULED' });
      expect(
        (await new TestBrowser(app).get(`/api/v1/products/${product.slug}`)).body.price.amount,
      ).toBe('99000.00');

      const backdated = await admin.send('post', `/api/v1/admin/products/${product.id}/prices`, {
        sellingPrice: '90000',
        costPrice: '75000',
        basedOnVersion: 2,
        effectiveFrom: new Date(Date.now() - 86_400_000).toISOString(),
      });
      expect(backdated.status).toBe(400);
    });

    it('keeps the historical price on existing orders when the price changes', async () => {
      const product = await createActiveProduct();
      const v1 = await prisma.productPrice.findFirstOrThrow({
        where: { productId: product.id, version: 1 },
      });
      const dbProduct = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
      const order = await createOrder(prisma, { product: dbProduct, price: v1, quantity: 2 });

      await admin.send('post', `/api/v1/admin/products/${product.id}/prices`, {
        sellingPrice: '150000',
        costPrice: '90000',
        basedOnVersion: 1,
      });

      const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
      expect(item.unitPriceSnapshot.toFixed(2)).toBe('99000.00');
      expect(item.productPriceId).toBe(v1.id);
      expect(
        (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).total.toFixed(2),
      ).toBe('198000.00');
      expect((await admin.get(`/api/v1/admin/products/${product.id}`)).body.hasOrders).toBe(true);
    });

    it('locks the Robux amount once a product has orders but allows renaming', async () => {
      const product = await createActiveProduct();
      const v1 = await prisma.productPrice.findFirstOrThrow({ where: { productId: product.id } });
      await createOrder(prisma, {
        product: await prisma.product.findUniqueOrThrow({ where: { id: product.id } }),
        price: v1,
      });
      const locked = await admin.send('patch', `/api/v1/admin/products/${product.id}`, {
        robuxAmount: 800,
      });
      expect(locked.status).toBe(409);
      const renamed = await admin.send('patch', `/api/v1/admin/products/${product.id}`, {
        name: 'Robux 750 Hemat',
      });
      expect(renamed.status).toBe(200);
      expect(renamed.body.name).toBe('Robux 750 Hemat');
    });
  });

  describe('customer catalog and quotes', () => {
    it('quotes totals from the backend and keeps every price surface consistent', async () => {
      const product = await createActiveProduct();
      const anonymous = new TestBrowser(app);
      const catalog = await anonymous.get(`/api/v1/products/${product.slug}`);
      const quote = await anonymous.get(`/api/v1/products/${product.slug}/quote?quantity=3`);
      const adminView = await admin.get(`/api/v1/admin/products/${product.id}`);

      expect(quote.status).toBe(200);
      expect(quote.body).toMatchObject({
        quantity: 3,
        unitPrice: '99000.00',
        subtotal: '297000.00',
        total: '297000.00',
        totalRobux: 2250,
      });
      expect(catalog.body.price.amount).toBe(quote.body.unitPrice);
      expect(adminView.body.currentPrice.sellingPrice).toBe(quote.body.unitPrice);
    });

    it('validates quantity on the backend', async () => {
      const product = await createActiveProduct({ maxQuantity: 5 });
      const anonymous = new TestBrowser(app);
      const quote = (q: string) =>
        anonymous.get(`/api/v1/products/${product.slug}/quote?quantity=${q}`);
      expect((await quote('0')).status).toBe(400);
      expect((await quote('abc')).status).toBe(400);
      expect((await quote('1.5')).status).toBe(400);
      const tooMany = await quote('6');
      expect(tooMany.status).toBe(400);
      expect(tooMany.body.code).toBe('QUANTITY_OUT_OF_RANGE');
      expect((await quote('5')).status).toBe(200);
    });

    it('never exposes cost data to customers', async () => {
      const product = await createActiveProduct();
      const body = JSON.stringify((await new TestBrowser(app).get('/api/v1/products')).body);
      expect(body).not.toMatch(/cost|margin/i);
      expect(body).toContain(product.slug);
    });
  });
});
