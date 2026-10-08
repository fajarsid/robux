import type { NestExpressApplication } from '@nestjs/platform-express';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import {
  createTestApp,
  createUser,
  TEST_PASSWORD,
  TestBrowser,
  totpCodeFor,
} from '../support/test-app';
import { createTestPrisma } from '../support/test-database';

describe('staff authentication and 2FA', () => {
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

  it('signs in staff without 2FA fully, with the normal staff session lifetime', async () => {
    const admin = await createUser(prisma, 'ADMIN');
    const browser = new TestBrowser(app);
    expect((await browser.login(admin.email, TEST_PASSWORD, 'staff')).status).toBe(204);

    const session = await browser.refreshSession();
    expect(session).toMatchObject({ authenticated: true, twoFactor: 'NOT_ENROLLED' });
    const expiresAt = new Date(session.expiresAt ?? 0).getTime();
    expect(expiresAt - Date.now()).toBeGreaterThan(60 * 60_000);
    expect((await browser.get('/api/v1/admin/me')).status).toBe(200);
    // Permissions still come from the role: an ADMIN without 2FA is not a SUPER_ADMIN.
    expect((await browser.get('/api/v1/admin/staff')).status).toBe(403);
  });

  it('enforces TOTP on every login once a staff member has enabled it', async () => {
    const admin = await createUser(prisma, 'ADMIN');
    await new TestBrowser(app).loginStaffWithEnrollment(admin.email);

    const browser = new TestBrowser(app);
    await browser.login(admin.email, TEST_PASSWORD, 'staff');
    const session = await browser.refreshSession();
    expect(session.twoFactor).toBe('PENDING');
    const expiresAt = new Date(session.expiresAt ?? 0).getTime();
    expect(expiresAt - Date.now()).toBeLessThanOrEqual(5 * 60_000);

    const blocked = await browser.get('/api/v1/admin/me');
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('TWO_FACTOR_REQUIRED');
    // A pending session can neither read data nor replace the enrolled factor.
    expect(
      (await browser.get('/api/v1/admin/orders/00000000-0000-7000-8000-000000000000')).status,
    ).toBe(403);
    expect((await browser.send('post', '/api/v1/admin/auth/2fa/setup')).status).toBe(403);
  });

  it('enrolls TOTP, shows recovery codes once and stores secrets protected', async () => {
    const admin = await createUser(prisma, 'ADMIN');
    const browser = new TestBrowser(app);
    const { secret, recoveryCodes } = await browser.loginStaffWithEnrollment(admin.email);

    expect(recoveryCodes).toHaveLength(10);
    expect(new Set(recoveryCodes).size).toBe(10);
    expect((await browser.refreshSession()).twoFactor).toBe('VERIFIED');
    expect((await browser.get('/api/v1/admin/me')).status).toBe(200);

    const stored = await prisma.adminTwoFactor.findUniqueOrThrow({ where: { userId: admin.id } });
    expect(Buffer.from(stored.secretCiphertext).toString('latin1')).not.toContain(secret);
    const codes = await prisma.adminRecoveryCode.findMany({ where: { userId: admin.id } });
    expect(codes).toHaveLength(10);
    for (const code of codes) {
      expect(code.codeHash).toMatch(/^\$argon2id\$/);
      expect(recoveryCodes).not.toContain(code.codeHash);
    }

    expect((await browser.send('post', '/api/v1/admin/auth/2fa/setup')).status).toBe(403);
    const audit = await prisma.auditLog.findMany({
      where: { actorUserId: admin.id },
      select: { action: true },
    });
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(['LOGIN', 'TWO_FACTOR_ENABLED']),
    );
    expect(JSON.stringify(audit)).not.toContain(secret);
  });

  it('verifies TOTP on later logins and rejects wrong and replayed codes', async () => {
    const admin = await createUser(prisma, 'SUPER_ADMIN');
    const { secret } = await new TestBrowser(app).loginStaffWithEnrollment(admin.email);

    const browser = new TestBrowser(app);
    await browser.login(admin.email, TEST_PASSWORD, 'staff');
    expect((await browser.refreshSession()).twoFactor).toBe('PENDING');

    const wrong = await browser.send('post', '/api/v1/admin/auth/2fa/verify', { code: '000000' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.code).toBe('INVALID_TWO_FACTOR_CODE');

    // The enrollment consumed the current time step; the next step is within the drift window.
    const nextCode = totpCodeFor(secret, 1);
    expect(
      (await browser.send('post', '/api/v1/admin/auth/2fa/verify', { code: nextCode })).status,
    ).toBe(204);
    expect((await browser.refreshSession()).twoFactor).toBe('VERIFIED');

    const replay = new TestBrowser(app);
    await replay.login(admin.email, TEST_PASSWORD, 'staff');
    expect(
      (await replay.send('post', '/api/v1/admin/auth/2fa/verify', { code: nextCode })).status,
    ).toBe(401);
  });

  it('accepts each recovery code exactly once', async () => {
    const admin = await createUser(prisma, 'OPERATOR');
    const { recoveryCodes } = await new TestBrowser(app).loginStaffWithEnrollment(admin.email);
    const code = recoveryCodes[0]!;

    const first = new TestBrowser(app);
    await first.login(admin.email, TEST_PASSWORD, 'staff');
    expect(
      (
        await first.send('post', '/api/v1/admin/auth/2fa/recovery', {
          recoveryCode: code.toLowerCase(),
        })
      ).status,
    ).toBe(204);
    expect((await first.refreshSession()).twoFactor).toBe('VERIFIED');

    const second = new TestBrowser(app);
    await second.login(admin.email, TEST_PASSWORD, 'staff');
    const reuse = await second.send('post', '/api/v1/admin/auth/2fa/recovery', {
      recoveryCode: code,
    });
    expect(reuse.status).toBe(401);
    expect((await second.refreshSession()).twoFactor).toBe('PENDING');

    const used = await prisma.adminRecoveryCode.count({
      where: { userId: admin.id, usedAt: { not: null } },
    });
    expect(used).toBe(1);
    const actions = (await prisma.auditLog.findMany({ where: { actorUserId: admin.id } })).map(
      (a) => a.action,
    );
    expect(actions).toEqual(expect.arrayContaining(['RECOVERY_CODE_USED', 'TWO_FACTOR_FAILURE']));
  });

  it('does not let customers use the admin login', async () => {
    const customer = await createUser(prisma, 'CUSTOMER');
    const response = await new TestBrowser(app).send('post', '/api/v1/admin/auth/login', {
      email: customer.email,
      password: TEST_PASSWORD,
    });
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('keeps 2FA endpoints closed to customers and to unauthenticated callers', async () => {
    const customer = await createUser(prisma, 'CUSTOMER');
    const browser = new TestBrowser(app);
    await browser.login(customer.email);
    expect((await browser.send('post', '/api/v1/admin/auth/2fa/setup')).status).toBe(403);
    expect((await new TestBrowser(app).send('post', '/api/v1/admin/auth/2fa/setup')).status).toBe(
      401,
    );
  });
});
