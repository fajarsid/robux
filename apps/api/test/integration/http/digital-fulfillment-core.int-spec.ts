import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import { createOrder, createProductWithPrice, createSource, uniqueSlug } from '../support/fixtures';
import { createTestApp, signInAs, TestBrowser } from '../support/test-app';
import { createTestPrisma, expectDatabaseError } from '../support/test-database';

const newKey = () => randomBytes(16).toString('hex');

/**
 * Phase 11 (ADR-009): the product line decides fulfillment type, platform and recipient; the order
 * snapshots them; checkout validates the recipient the product needs and nothing else.
 */
describe('digital fulfillment core: products, checkout and order snapshot', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let admin: TestBrowser;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = createTestPrisma();
    admin = (await signInAs(app, prisma, 'ADMIN')).browser;
    // Stock for every line used below (Premium deliberately has none).
    // Small on purpose: suites share the database and other tests rely on total Robux stock.
    await createSource(prisma, 100_000n);
    await createSource(prisma, 1_000_000n, { productLine: 'TELEGRAM_STARS' });
    await createSource(prisma, 1_000n, { productLine: 'TELEGRAM_ACCOUNT' });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  function placeOrder(offer: { product: { id: string }; price: { id: string } }, extra: object) {
    return new TestBrowser(app).send(
      'post',
      '/api/v1/orders',
      {
        productId: offer.product.id,
        priceVersionId: offer.price.id,
        quantity: 1,
        contactEmail: 'guest@example.test',
        ...extra,
      },
      { headers: { 'Idempotency-Key': newKey() } },
    );
  }

  const orderRow = (orderNumber: string) =>
    prisma.order.findUniqueOrThrow({ where: { orderNumber } });

  it('Robux keeps its contract and is snapshotted as ROBLOX / BALANCE_PURCHASE', async () => {
    const offer = await createProductWithPrice(prisma);
    const response = await placeOrder(offer, { recipient: { robloxUsername: 'Builder_Kid' } });
    expect(response.status).toBe(201);
    expect(response.body.recipientUsername).toBe('Builder_Kid');
    expect(await orderRow(response.body.orderNumber)).toMatchObject({
      productLine: 'ROBLOX_ROBUX',
      platform: 'ROBLOX',
      fulfillmentType: 'BALANCE_PURCHASE',
      recipientType: 'ROBLOX_USER',
      recipientUsername: 'Builder_Kid',
    });
  });

  it('Telegram Stars needs a Telegram username and is snapshotted as RECIPIENT_FULFILLMENT', async () => {
    const offer = await createProductWithPrice(prisma, {
      robuxAmount: 100,
      productLine: 'TELEGRAM_STARS',
    });
    const ok = await placeOrder(offer, { recipient: { telegramUsername: '@durov_team' } });
    expect(ok.status).toBe(201);
    expect(ok.body.recipientUsername).toBe('durov_team');
    expect(await orderRow(ok.body.orderNumber)).toMatchObject({
      productLine: 'TELEGRAM_STARS',
      platform: 'TELEGRAM',
      fulfillmentType: 'RECIPIENT_FULFILLMENT',
      recipientType: 'TELEGRAM_USER',
      recipientUsername: 'durov_team',
      recipientRobloxUserId: null,
    });

    for (const extra of [{ recipient: { robloxUsername: 'Builder_Kid' } }, {}]) {
      const refused = await placeOrder(offer, extra);
      expect(refused.status).toBe(400);
      expect(refused.body.code).toBe('VALIDATION_FAILED');
    }
  });

  it('a Telegram account takes no recipient and is snapshotted as DIGITAL_DELIVERY', async () => {
    const offer = await createProductWithPrice(prisma, {
      robuxAmount: 1,
      productLine: 'TELEGRAM_ACCOUNT',
    });
    const ok = await placeOrder(offer, {});
    expect(ok.status).toBe(201);
    expect(ok.body.recipientUsername).toBeNull();
    expect(await orderRow(ok.body.orderNumber)).toMatchObject({
      platform: 'TELEGRAM',
      fulfillmentType: 'DIGITAL_DELIVERY',
      recipientType: null,
      recipientUsername: null,
    });
    const refused = await placeOrder(offer, { recipient: { telegramUsername: 'durov_team' } });
    expect(refused.status).toBe(400);
  });

  it('never accepts a client-chosen fulfillment type, platform or product line', async () => {
    const offer = await createProductWithPrice(prisma);
    for (const extra of [
      { fulfillmentType: 'DIGITAL_DELIVERY' },
      { platform: 'TELEGRAM' },
      { productLine: 'TELEGRAM_ACCOUNT' },
    ]) {
      const response = await placeOrder(offer, {
        recipient: { robloxUsername: 'Builder_Kid' },
        ...extra,
      });
      expect(response.status).toBe(400);
    }
  });

  it('refuses inactive products', async () => {
    const offer = await createProductWithPrice(prisma, {
      productLine: 'TELEGRAM_STARS',
      isActive: false,
    });
    const response = await placeOrder(offer, { recipient: { telegramUsername: 'durov_team' } });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('PRODUCT_INACTIVE');
  });

  it('counts stock per product line: Robux and Stars balances never make Premium available', async () => {
    const premium = await createProductWithPrice(prisma, {
      robuxAmount: 3,
      productLine: 'TELEGRAM_PREMIUM',
    });
    // The integration database can retain mock sources from previous runs. Temporarily disable
    // only Premium sources so this test proves that Robux and Stars stock cannot substitute.
    const premiumSources = await prisma.fulfillmentSource.findMany({
      where: { productLine: 'TELEGRAM_PREMIUM' },
      select: { id: true, status: true },
    });
    await prisma.fulfillmentSource.updateMany({
      where: { id: { in: premiumSources.map((source) => source.id) } },
      data: { status: 'DISABLED' },
    });
    try {
      const catalog = await new TestBrowser(app).get(`/api/v1/products/${premium.product.slug}`);
      expect(catalog.body).toMatchObject({
        productLine: 'TELEGRAM_PREMIUM',
        platform: 'TELEGRAM',
        fulfillmentType: 'RECIPIENT_FULFILLMENT',
        recipientType: 'TELEGRAM_USER',
        unit: 'PREMIUM_MONTH',
        availability: 'OUT_OF_STOCK',
      });
      expect(catalog.body).not.toHaveProperty('sources');
      const order = await placeOrder(premium, { recipient: { telegramUsername: 'durov_team' } });
      expect(order.status).toBe(409);
      expect(order.body.code).toBe('PRODUCT_UNAVAILABLE');
    } finally {
      await Promise.all(
        premiumSources.map((source) =>
          prisma.fulfillmentSource.update({
            where: { id: source.id },
            data: { status: source.status },
          }),
        ),
      );
    }
  });

  it('admin creates products per line; line and gamepass rules are enforced; the snapshot outlives edits', async () => {
    const created = await admin.send('post', '/api/v1/admin/products', {
      slug: uniqueSlug('tg-stars'),
      name: 'Telegram Stars 100',
      robuxAmount: 100,
      fulfillmentMethod: 'INSTANT',
      productLine: 'TELEGRAM_STARS',
      initialPrice: { sellingPrice: '30000', costPrice: '25000' },
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      productLine: 'TELEGRAM_STARS',
      platform: 'TELEGRAM',
      fulfillmentType: 'RECIPIENT_FULFILLMENT',
      unit: 'STAR',
    });

    const gamepass = await admin.send('post', '/api/v1/admin/products', {
      slug: uniqueSlug('tg-gamepass'),
      name: 'Wrong',
      robuxAmount: 100,
      fulfillmentMethod: 'GAMEPASS',
      productLine: 'TELEGRAM_PREMIUM',
      initialPrice: { sellingPrice: '30000', costPrice: '25000' },
    });
    expect(gamepass.status).toBe(400);

    // Default stays Robux for existing clients that do not send a line.
    const legacy = await admin.send('post', '/api/v1/admin/products', {
      slug: uniqueSlug('robux'),
      name: 'Robux 750',
      robuxAmount: 750,
      fulfillmentMethod: 'INSTANT',
      initialPrice: { sellingPrice: '99000', costPrice: '75000' },
    });
    expect(legacy.body).toMatchObject({
      productLine: 'ROBLOX_ROBUX',
      fulfillmentType: 'BALANCE_PURCHASE',
    });

    // An order exists: the line is locked, and the order keeps what it was bought as.
    await admin.send('post', `/api/v1/admin/products/${created.body.id}/activate`);
    const offer = {
      product: { id: created.body.id as string },
      price: { id: created.body.currentPrice.id as string },
    };
    const order = await placeOrder(offer, { recipient: { telegramUsername: 'durov_team' } });
    expect(order.status).toBe(201);
    const change = await admin.send('patch', `/api/v1/admin/products/${created.body.id}`, {
      name: 'Telegram Premium?',
      robuxAmount: 100,
      fulfillmentMethod: 'INSTANT',
      productLine: 'TELEGRAM_PREMIUM',
      minQuantity: 1,
      maxQuantity: 10,
      displayOrder: 0,
    });
    expect(change.status).toBe(409);
    await admin.send('patch', `/api/v1/admin/products/${created.body.id}`, {
      name: 'Telegram Stars 100 (renamed)',
      robuxAmount: 100,
      fulfillmentMethod: 'INSTANT',
      productLine: 'TELEGRAM_STARS',
      minQuantity: 1,
      maxQuantity: 10,
      displayOrder: 0,
    });
    expect(await orderRow(order.body.orderNumber)).toMatchObject({
      productLine: 'TELEGRAM_STARS',
      fulfillmentType: 'RECIPIENT_FULFILLMENT',
    });
  });

  it('the database refuses snapshots that contradict their product line or recipient', async () => {
    const { product, price } = await createProductWithPrice(prisma);
    const order = await createOrder(prisma, { product, price });
    await expectDatabaseError(
      prisma.order.update({
        where: { id: order.id },
        data: { fulfillmentType: 'DIGITAL_DELIVERY' },
      }),
      { constraint: 'orders_product_line_consistent' },
    );
    await expectDatabaseError(
      prisma.order.update({ where: { id: order.id }, data: { recipientUsername: null } }),
      { constraint: 'orders_recipient_matches_type' },
    );
    await expectDatabaseError(
      prisma.order.update({
        where: { id: order.id },
        data: {
          productLine: 'TELEGRAM_ACCOUNT',
          platform: 'TELEGRAM',
          fulfillmentType: 'DIGITAL_DELIVERY',
        },
      }),
      { constraint: 'orders_recipient_matches_type' },
    );
    await expectDatabaseError(
      prisma.product.update({
        where: { id: product.id },
        data: { productLine: 'TELEGRAM_STARS', fulfillmentMethod: 'GAMEPASS' },
      }),
      { constraint: 'products_gamepass_is_robux' },
    );
  });
});
