import type { NestExpressApplication } from '@nestjs/platform-express';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import type { UserRole } from '../../../src/generated/prisma/enums';
import { createTestApp, createUser, signInAs, TestBrowser } from '../support/test-app';
import { createTestPrisma } from '../support/test-database';

describe('role-based authorization', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = createTestPrisma();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const signedIn = (role: UserRole) => signInAs(app, prisma, role);

  it('rejects unauthenticated access to protected endpoints', async () => {
    const anonymous = new TestBrowser(app);
    for (const path of [
      '/api/v1/me',
      '/api/v1/me/orders',
      '/api/v1/admin/me',
      '/api/v1/admin/staff',
    ]) {
      const response = await anonymous.get(path);
      expect(response.status).toBe(401);
      expect(response.body.code).toBe('UNAUTHORIZED');
    }
  });

  it.each([
    ['CUSTOMER', { '/api/v1/me/orders': 200, '/api/v1/admin/me': 403, '/api/v1/admin/staff': 403 }],
    ['OPERATOR', { '/api/v1/me/orders': 403, '/api/v1/admin/me': 200, '/api/v1/admin/staff': 403 }],
    ['ADMIN', { '/api/v1/me/orders': 403, '/api/v1/admin/me': 200, '/api/v1/admin/staff': 403 }],
    [
      'SUPER_ADMIN',
      { '/api/v1/me/orders': 403, '/api/v1/admin/me': 200, '/api/v1/admin/staff': 200 },
    ],
  ] as const)('applies the permission matrix for %s', async (role, expectations) => {
    const { browser } = await signedIn(role);
    for (const [path, status] of Object.entries(expectations)) {
      expect({ path, status: (await browser.get(path)).status }).toEqual({ path, status });
    }
  });

  it('blocks privilege escalation by non-super-admins', async () => {
    const { user: admin, browser } = await signedIn('ADMIN');
    const operator = await createUser(prisma, 'OPERATOR');
    for (const target of [admin.id, operator.id]) {
      const response = await browser.send('patch', `/api/v1/admin/staff/${target}/role`, {
        role: 'SUPER_ADMIN',
      });
      expect(response.status).toBe(403);
    }
    expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).role).toBe('ADMIN');
  });

  it('does not let a super admin change their own role or promote a customer', async () => {
    const { user: superAdmin, browser } = await signedIn('SUPER_ADMIN');
    const self = await browser.send('patch', `/api/v1/admin/staff/${superAdmin.id}/role`, {
      role: 'OPERATOR',
    });
    expect(self.status).toBe(409);
    const customer = await createUser(prisma, 'CUSTOMER');
    const promote = await browser.send('patch', `/api/v1/admin/staff/${customer.id}/role`, {
      role: 'ADMIN',
    });
    expect(promote.status).toBe(404);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: customer.id } })).role).toBe(
      'CUSTOMER',
    );
  });

  it('lets a super admin change a staff role, ends the target sessions and audits it', async () => {
    const { user: superAdmin, browser } = await signedIn('SUPER_ADMIN');
    const { user: operator, browser: operatorBrowser } = await signedIn('OPERATOR');

    const response = await browser.send('patch', `/api/v1/admin/staff/${operator.id}/role`, {
      role: 'ADMIN',
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: operator.id, role: 'ADMIN' });
    expect((await operatorBrowser.get('/api/v1/admin/me')).status).toBe(401);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'STAFF_ACCOUNT_CHANGED', resourceId: operator.id },
    });
    expect(audit).toMatchObject({
      actorUserId: superAdmin.id,
      before: { role: 'OPERATOR' },
      after: { role: 'ADMIN' },
    });
  });

  it('rejects an invalid role value', async () => {
    const { browser } = await signedIn('SUPER_ADMIN');
    const operator = await createUser(prisma, 'OPERATOR');
    const response = await browser.send('patch', `/api/v1/admin/staff/${operator.id}/role`, {
      role: 'CUSTOMER',
    });
    expect(response.status).toBe(400);
  });
});
