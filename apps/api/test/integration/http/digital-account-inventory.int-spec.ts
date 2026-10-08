import type { NestExpressApplication } from '@nestjs/platform-express';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import { createProductWithPrice, createSource } from '../support/fixtures';
import { createTestApp, signInAs, type TestBrowser } from '../support/test-app';
import { createTestPrisma } from '../support/test-database';

describe('Telegram account inventory', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let admin: TestBrowser;
  let customer: TestBrowser;
  const base = '/api/v1/admin/inventory/accounts';

  beforeAll(async () => {
    app = await createTestApp();
    prisma = createTestPrisma();
    admin = (await signInAs(app, prisma, 'ADMIN')).browser;
    customer = (await signInAs(app, prisma, 'CUSTOMER')).browser;
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('encrypts on create, omits payload from lists and supports audited blocking with RBAC', async () => {
    const { product } = await createProductWithPrice(prisma, {
      productLine: 'TELEGRAM_ACCOUNT',
      robuxAmount: 1,
    });
    const source = await createSource(prisma, 0n, { productLine: 'TELEGRAM_ACCOUNT' });
    const secret = `pass-${Date.now()}-not-for-logs`;
    const created = await admin.send('post', base, {
      productId: product.id,
      sourceId: source.id,
      username: 'acct_name',
      password: secret,
      recoveryInfo: 'offline-code',
    });
    expect(created.status).toBe(201);
    expect(JSON.stringify(created.body)).not.toContain(secret);
    const stored = await prisma.digitalInventoryItem.findUniqueOrThrow({
      where: { id: created.body.id },
    });
    expect(Buffer.from(stored.encryptedPayload).toString('utf8')).not.toContain(secret);
    expect(stored.keyVersion).toBe(1);
    const listed = await admin.get(base);
    expect(listed.status).toBe(200);
    expect(JSON.stringify(listed.body)).not.toContain(secret);
    expect(listed.body[0]).not.toHaveProperty('encryptedPayload');
    expect((await customer.get(base)).status).toBe(403);
    expect((await admin.send('post', `${base}/${created.body.id}/block`)).status).toBe(201);
    expect(
      (await prisma.digitalInventoryItem.findUniqueOrThrow({ where: { id: created.body.id } }))
        .status,
    ).toBe('BLOCKED');
    expect(
      await prisma.fulfillmentSource.findUniqueOrThrow({ where: { id: source.id } }),
    ).toMatchObject({ availableBalance: 0n });
    expect(
      await prisma.auditLog.count({
        where: {
          resourceId: created.body.id,
          action: { in: ['INVENTORY_ITEM_CREATED', 'INVENTORY_ITEM_BLOCKED'] },
        },
      }),
    ).toBe(2);
  });
});
