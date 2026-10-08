import type { NestExpressApplication } from '@nestjs/platform-express';
import { createHash, randomUUID } from 'node:crypto';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import { createTestApp, createUser, TEST_PASSWORD, TestBrowser } from '../support/test-app';
import { createTestPrisma } from '../support/test-database';

describe('customer authentication', () => {
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

  const newEmail = () => `buyer-${randomUUID().slice(0, 8)}@example.test`;

  it('registers a customer, signs them in and stores only an Argon2id hash', async () => {
    const browser = new TestBrowser(app);
    const email = newEmail();
    const response = await browser.send('post', '/api/v1/auth/register', {
      email: email.toUpperCase(),
      password: TEST_PASSWORD,
      name: 'Budi',
    });
    expect(response.status).toBe(204);

    const session = await browser.refreshSession();
    expect(session).toMatchObject({
      authenticated: true,
      twoFactor: 'NOT_REQUIRED',
      user: { role: 'CUSTOMER' },
    });

    const stored = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
    expect(stored.passwordHash).not.toContain(TEST_PASSWORD);
    expect(JSON.stringify(response.body ?? {})).not.toContain('argon2');
  });

  it('rejects unknown fields, so no other credential (e.g. a Roblox password) can be submitted', async () => {
    const browser = new TestBrowser(app);
    const email = newEmail();
    const response = await browser.send('post', '/api/v1/auth/register', {
      email,
      password: TEST_PASSWORD,
      robloxPassword: 'should-never-be-accepted',
    });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_FAILED');
    expect(await prisma.user.count({ where: { email } })).toBe(0);
  });

  it('gives the same vague answer for an already registered email', async () => {
    const existing = await createUser(prisma, 'CUSTOMER');
    const response = await new TestBrowser(app).send('post', '/api/v1/auth/register', {
      email: existing.email,
      password: TEST_PASSWORD,
    });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'ACCOUNT_UNAVAILABLE' });
    expect(response.body.message).not.toMatch(/exist|terdaftar|sudah/i);
  });

  it('logs in, keeps the session across requests and returns the profile', async () => {
    const user = await createUser(prisma, 'CUSTOMER');
    const browser = new TestBrowser(app);
    expect((await browser.login(user.email)).status).toBe(204);
    for (let i = 0; i < 3; i += 1) {
      const me = await browser.get('/api/v1/me');
      expect(me.status).toBe(200);
      expect(me.body).toMatchObject({ id: user.id, email: user.email, role: 'CUSTOMER' });
      expect(me.body).not.toHaveProperty('passwordHash');
    }
  });

  it('answers a wrong password and an unknown email identically', async () => {
    const user = await createUser(prisma, 'CUSTOMER');
    const wrongPassword = await new TestBrowser(app).send('post', '/api/v1/auth/login', {
      email: user.email,
      password: 'not-the-password',
    });
    const unknownEmail = await new TestBrowser(app).send('post', '/api/v1/auth/login', {
      email: newEmail(),
      password: 'not-the-password',
    });
    for (const response of [wrongPassword, unknownEmail]) {
      expect(response.status).toBe(401);
      expect(response.headers['set-cookie']).toBeUndefined();
    }
    expect(wrongPassword.body.code).toBe(unknownEmail.body.code);
    expect(wrongPassword.body.message).toBe(unknownEmail.body.message);
  });

  it('records login attempts with a hashed email and never the password', async () => {
    const user = await createUser(prisma, 'CUSTOMER');
    const browser = new TestBrowser(app);
    await browser.send('post', '/api/v1/auth/login', {
      email: user.email,
      password: 'wrong-password-1',
    });
    await browser.login(user.email);

    const emailHash = createHash('sha256').update(user.email).digest('hex');
    const attempts = await prisma.loginAttempt.findMany({
      where: { emailHash },
      orderBy: { id: 'asc' },
    });
    expect(attempts.map((a) => [a.succeeded, a.failureReason])).toEqual([
      [false, 'INVALID_CREDENTIALS'],
      [true, null],
    ]);
    expect(attempts[0]?.ipAddress).toBe(browser.ip);
    expect(JSON.stringify(attempts)).not.toContain('wrong-password-1');
    expect(JSON.stringify(attempts)).not.toContain(user.email);
  });

  it('does not let staff accounts sign in through the customer login', async () => {
    const admin = await createUser(prisma, 'ADMIN');
    const response = await new TestBrowser(app).send('post', '/api/v1/auth/login', {
      email: admin.email,
      password: TEST_PASSWORD,
    });
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('logs out by revoking the server-side session', async () => {
    const user = await createUser(prisma, 'CUSTOMER');
    const browser = new TestBrowser(app);
    await browser.login(user.email);
    const stolenCookie = browser.cookie;

    expect((await browser.send('post', '/api/v1/auth/logout')).status).toBe(204);
    expect(browser.cookie).toBeUndefined();

    const replay = new TestBrowser(app);
    replay.cookie = stolenCookie;
    expect((await replay.get('/api/v1/me')).status).toBe(401);
    expect((await replay.refreshSession()).authenticated).toBe(false);
  });

  it('changes the password, rotates this session and signs out every other session', async () => {
    const user = await createUser(prisma, 'CUSTOMER');
    const laptop = new TestBrowser(app);
    const phone = new TestBrowser(app);
    await laptop.login(user.email);
    await phone.login(user.email);
    const laptopCookieBefore = laptop.cookie;

    const wrongCurrent = await laptop.send('post', '/api/v1/me/password', {
      currentPassword: 'not-it-at-all',
      newPassword: 'a-brand-new-password',
    });
    expect(wrongCurrent.status).toBe(400);

    const change = await laptop.send('post', '/api/v1/me/password', {
      currentPassword: TEST_PASSWORD,
      newPassword: 'a-brand-new-password',
    });
    expect(change.status).toBe(204);
    expect(laptop.cookie).not.toBe(laptopCookieBefore);
    await laptop.refreshSession();
    expect((await laptop.get('/api/v1/me')).status).toBe(200);
    expect((await phone.get('/api/v1/me')).status).toBe(401);

    expect((await new TestBrowser(app).login(user.email)).status).toBe(401);
    expect((await new TestBrowser(app).login(user.email, 'a-brand-new-password')).status).toBe(204);
  });
});
