import type { NestExpressApplication } from '@nestjs/platform-express';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import { createSource, uniqueSlug } from '../support/fixtures';
import { createTestApp, signInAs, TestBrowser } from '../support/test-app';
import { createTestPrisma } from '../support/test-database';

/** Staff source management: RBAC, kill switch, adjustments, audit and what the API never returns. */
describe('admin inventory sources', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let admin: TestBrowser;
  let operator: TestBrowser;
  let customer: TestBrowser;
  const base = '/api/v1/admin/inventory/sources';

  beforeAll(async () => {
    app = await createTestApp();
    prisma = createTestPrisma();
    admin = (await signInAs(app, prisma, 'ADMIN')).browser;
    operator = (await signInAs(app, prisma, 'OPERATOR')).browser;
    customer = (await signInAs(app, prisma, 'CUSTOMER')).browser;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const createRequest = (overrides: Record<string, unknown> = {}) => ({
    name: uniqueSlug('Source'),
    provider: 'mock',
    priority: 5,
    lowBalanceThreshold: '1000',
    costPerUnit: '95.5000',
    openingBalance: '1500',
    ...overrides,
  });

  it('creates a source DISABLED with UNKNOWN health and an opening ledger entry, audited', async () => {
    const response = await admin.send('post', base, createRequest());
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      status: 'DISABLED',
      health: 'UNKNOWN',
      availableBalance: '1500',
      reservedBalance: '0',
      costPerUnit: '95.5000',
      lowBalance: false,
    });
    expect(response.body).not.toHaveProperty('credentialRef');
    const ledger = await prisma.sourceBalanceLog.findMany({
      where: { sourceId: response.body.id },
    });
    expect(ledger).toMatchObject([{ reason: 'ADJUSTMENT', deltaAvailable: 1500n }]);
    expect(
      await prisma.auditLog.count({
        where: { resourceId: response.body.id, action: 'SOURCE_CREATED' },
      }),
    ).toBe(1);
  });

  it('refuses duplicate names and invalid input', async () => {
    const request = createRequest();
    expect((await admin.send('post', base, request)).status).toBe(201);
    const duplicate = await admin.send('post', base, request);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('INVALID_SOURCE_STATE');
    expect((await admin.send('post', base, createRequest({ provider: 'Mock X' }))).status).toBe(
      400,
    );
    expect((await admin.send('post', base, createRequest({ openingBalance: '-1' }))).status).toBe(
      400,
    );
    expect(
      (await admin.send('post', base, createRequest({ credentialRef: 'secret/name' }))).status,
    ).toBe(400);
  });

  it('kill switch: activate and deactivate, each audited; repeating is a no-op', async () => {
    const created = (await admin.send('post', base, createRequest())).body;
    const on = await admin.send('post', `${base}/${created.id}/activate`);
    expect(on.status).toBe(200);
    expect(on.body.status).toBe('ACTIVE');
    expect((await admin.send('post', `${base}/${created.id}/activate`)).status).toBe(200);
    const off = await admin.send('post', `${base}/${created.id}/deactivate`);
    expect(off.body.status).toBe('DISABLED');
    const actions = await prisma.auditLog.findMany({
      where: { resourceId: created.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(actions.map((a) => a.action)).toEqual([
      'SOURCE_CREATED',
      'SOURCE_ENABLED',
      'SOURCE_DISABLED',
    ]);
  });

  it('adjusts the balance through the ledger, never below zero, and edges into low balance once', async () => {
    const created = (await admin.send('post', base, createRequest({ openingBalance: '1500' })))
      .body;
    const down = await admin.send('post', `${base}/${created.id}/adjustments`, {
      delta: '-600',
      reason: 'Stock opname',
    });
    expect(down.status).toBe(200);
    expect(down.body).toMatchObject({ availableBalance: '900', lowBalance: true });
    expect(
      (
        await admin.send('post', `${base}/${created.id}/adjustments`, {
          delta: '-901',
          reason: 'Too much',
        })
      ).status,
    ).toBe(409);
    await admin.send('post', `${base}/${created.id}/adjustments`, {
      delta: '-100',
      reason: 'More',
    });
    const events = await prisma.outboxEvent.count({
      where: { aggregateId: created.id, eventType: 'SOURCE_LOW_BALANCE' },
    });
    expect(events).toBe(1);
    const up = await admin.send('post', `${base}/${created.id}/adjustments`, {
      delta: '5000',
      reason: 'Top up',
    });
    expect(up.body).toMatchObject({ availableBalance: '5800', lowBalance: false });
    expect(
      (await admin.send('post', `${base}/${created.id}/adjustments`, { delta: '0', reason: 'x' }))
        .status,
    ).toBe(400);
  });

  it('edits name, priority, threshold and cost but never the provider', async () => {
    const created = (await admin.send('post', base, createRequest())).body;
    const edited = await admin.send('patch', `${base}/${created.id}`, {
      name: `${created.name} edited`,
      priority: 1,
      lowBalanceThreshold: '2000',
      costPerUnit: null,
    });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({
      priority: 1,
      lowBalanceThreshold: '2000',
      costPerUnit: null,
      lowBalance: true,
      provider: 'mock',
    });
    const withProvider = await admin.send('patch', `${base}/${created.id}`, {
      name: created.name,
      priority: 1,
      lowBalanceThreshold: '0',
      costPerUnit: null,
      provider: 'other',
    });
    expect(withProvider.status).toBe(400);
  });

  it('RBAC: OPERATOR reads without costs and cannot change anything; customers are refused', async () => {
    const source = await createSource(prisma, 100n, { costPerUnit: '90' });
    const list = await operator.get(base);
    expect(list.status).toBe(200);
    const row = list.body.find((s: { id: string }) => s.id === source.id);
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty('costPerUnit');
    expect((await operator.send('post', base, createRequest())).status).toBe(403);
    expect((await operator.send('post', `${base}/${source.id}/deactivate`)).status).toBe(403);
    expect(
      (
        await operator.send('post', `${base}/${source.id}/adjustments`, {
          delta: '1',
          reason: 'xx x',
        })
      ).status,
    ).toBe(403);
    expect((await customer.get(base)).status).toBe(403);
    const anonymous = new TestBrowser(app);
    expect((await anonymous.get(base)).status).toBe(401);
  });
});
