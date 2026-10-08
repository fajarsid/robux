import type { NestExpressApplication } from '@nestjs/platform-express';
import Redis from 'ioredis';
import request from 'supertest';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import { generateOpaqueToken } from '../../../src/common/security/opaque-token';
import {
  createTestApp,
  createUser,
  TEST_PASSWORD,
  TestBrowser,
  TRUSTED_ORIGIN,
  wrongPassword,
} from '../support/test-app';
import { createTestPrisma } from '../support/test-database';

describe('session, CSRF, CORS and rate-limit security', () => {
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

  describe('CSRF', () => {
    it('rejects state-changing requests without a trusted Origin', async () => {
      const user = await createUser(prisma, 'CUSTOMER');
      const body = { email: user.email, password: TEST_PASSWORD };
      const noOrigin = await new TestBrowser(app).send('post', '/api/v1/auth/login', body, {
        origin: null,
      });
      const foreign = await new TestBrowser(app).send('post', '/api/v1/auth/login', body, {
        origin: 'https://evil.example',
      });
      for (const response of [noOrigin, foreign]) {
        expect(response.status).toBe(403);
        expect(response.body.code).toBe('CSRF_REJECTED');
      }
    });

    it('accepts a trusted Referer when Origin is absent', async () => {
      const user = await createUser(prisma, 'CUSTOMER');
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Referer', `${TRUSTED_ORIGIN}/login`)
        .set('X-Forwarded-For', '10.200.0.1')
        .send({ email: user.email, password: TEST_PASSWORD });
      expect(response.status).toBe(204);
    });

    it('requires the session-bound CSRF token on authenticated requests', async () => {
      const user = await createUser(prisma, 'CUSTOMER');
      const browser = new TestBrowser(app);
      await browser.login(user.email);
      const other = new TestBrowser(app);
      await other.login((await createUser(prisma, 'CUSTOMER')).email);

      const missing = await browser.send('post', '/api/v1/auth/logout', undefined, { csrf: false });
      const ownToken = browser.csrfToken;
      browser.csrfToken = other.csrfToken;
      const foreignToken = await browser.send('post', '/api/v1/auth/logout');
      browser.csrfToken = ownToken;
      for (const response of [missing, foreignToken]) {
        expect(response.status).toBe(403);
        expect(response.body.code).toBe('CSRF_REJECTED');
      }
      expect((await browser.get('/api/v1/me')).status).toBe(200);
      expect((await browser.send('post', '/api/v1/auth/logout')).status).toBe(204);
    });
  });

  describe('CORS', () => {
    it('admits only the exact trusted origin, never a wildcard', async () => {
      const preflight = (origin: string) =>
        request(app.getHttpServer())
          .options('/api/v1/auth/login')
          .set('Origin', origin)
          .set('Access-Control-Request-Method', 'POST');
      const trusted = await preflight(TRUSTED_ORIGIN);
      expect(trusted.headers['access-control-allow-origin']).toBe(TRUSTED_ORIGIN);
      expect(trusted.headers['access-control-allow-credentials']).toBe('true');
      const evil = await preflight('https://evil.example');
      expect(evil.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('sessions', () => {
    it('issues a __Host- cookie that is HttpOnly, Secure, SameSite=Lax and host-only', async () => {
      const secureApp = await createTestApp({ SESSION_COOKIE_SECURE: 'true' });
      try {
        const user = await createUser(prisma, 'CUSTOMER');
        const response = await request(secureApp.getHttpServer())
          .post('/api/v1/auth/login')
          .set('Origin', TRUSTED_ORIGIN)
          .set('X-Forwarded-For', '10.201.0.1')
          .send({ email: user.email, password: TEST_PASSWORD });
        const cookie = (response.headers['set-cookie'] as unknown as string[])[0]!;
        expect(cookie).toMatch(/^__Host-sid=[A-Za-z0-9_-]{43};/);
        expect(cookie).toMatch(/; HttpOnly/);
        expect(cookie).toMatch(/; Secure/);
        expect(cookie).toMatch(/; SameSite=Lax/);
        expect(cookie).toMatch(/; Path=\//);
        expect(cookie).not.toMatch(/Domain=/i);
      } finally {
        await secureApp.close();
      }
    });

    it('never authenticates a session id chosen before login (fixation)', async () => {
      const user = await createUser(prisma, 'CUSTOMER');
      const planted = generateOpaqueToken().token;
      const browser = new TestBrowser(app);
      browser.cookie = `sid=${planted}`;
      await browser.login(user.email);
      expect(browser.cookie).not.toBe(`sid=${planted}`);

      const attacker = new TestBrowser(app);
      attacker.cookie = `sid=${planted}`;
      expect((await attacker.refreshSession()).authenticated).toBe(false);
    });

    it('revokes the session an attacker planted when the victim logs in with it', async () => {
      const attackerUser = await createUser(prisma, 'CUSTOMER');
      const victim = await createUser(prisma, 'CUSTOMER');
      const attacker = new TestBrowser(app);
      await attacker.login(attackerUser.email);

      const victimBrowser = new TestBrowser(app);
      victimBrowser.cookie = attacker.cookie;
      // Like the real login page, the browser first loads the session (and its CSRF token).
      await victimBrowser.refreshSession();
      await victimBrowser.login(victim.email);
      expect((await attacker.get('/api/v1/me')).status).toBe(401);
      expect((await victimBrowser.get('/api/v1/me')).body.id).toBe(victim.id);
    });

    it('treats reuse of a rotated token as theft and revokes the whole session family', async () => {
      const user = await createUser(prisma, 'CUSTOMER');
      const browser = new TestBrowser(app);
      await browser.login(user.email);
      const rotatedAway = browser.cookie;
      await browser.send('post', '/api/v1/me/password', {
        currentPassword: TEST_PASSWORD,
        newPassword: 'rotated-password-1',
      });
      await browser.refreshSession();
      expect(browser.cookie).not.toBe(rotatedAway);
      expect((await browser.get('/api/v1/me')).status).toBe(200);

      const thief = new TestBrowser(app);
      thief.cookie = rotatedAway;
      expect((await thief.get('/api/v1/me')).status).toBe(401);
      expect((await browser.get('/api/v1/me')).status).toBe(401);
    });

    it('rejects expired sessions', async () => {
      const user = await createUser(prisma, 'CUSTOMER');
      const browser = new TestBrowser(app);
      await browser.login(user.email);
      await prisma.userSession.updateMany({
        where: { userId: user.id },
        data: { idleExpiresAt: new Date(Date.now() - 1000) },
      });
      expect((await browser.get('/api/v1/me')).status).toBe(401);
    });

    it('ends sessions of a suspended user immediately', async () => {
      const user = await createUser(prisma, 'CUSTOMER');
      const browser = new TestBrowser(app);
      await browser.login(user.email);
      await prisma.user.update({ where: { id: user.id }, data: { status: 'SUSPENDED' } });
      expect((await browser.get('/api/v1/me')).status).toBe(401);
    });
  });

  describe('rate limiting', () => {
    it('limits login attempts per account and client, with Retry-After', async () => {
      const user = await createUser(prisma, 'CUSTOMER');
      const browser = new TestBrowser(app);
      const statuses: number[] = [];
      let last;
      for (let i = 0; i < 11; i += 1) {
        last = await browser.send('post', '/api/v1/auth/login', {
          email: user.email,
          password: wrongPassword(),
        });
        statuses.push(last.status);
      }
      expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
      expect(statuses[10]).toBe(429);
      expect(last?.body.code).toBe('RATE_LIMITED');
      expect(Number(last?.headers['retry-after'])).toBeGreaterThan(0);

      // Even the right password is refused while limited, and other clients are unaffected.
      expect((await browser.login(user.email)).status).toBe(429);
      expect((await new TestBrowser(app).login(user.email)).status).toBe(204);
    });

    it('limits 2FA guesses per user across sessions', async () => {
      const admin = await createUser(prisma, 'ADMIN');
      await new TestBrowser(app).loginStaffWithEnrollment(admin.email);
      const browser = new TestBrowser(app);
      await browser.login(admin.email, TEST_PASSWORD, 'staff');
      const statuses: number[] = [];
      for (let i = 0; i < 6; i += 1) {
        statuses.push(
          (await browser.send('post', '/api/v1/admin/auth/2fa/verify', { code: '000000' })).status,
        );
      }
      // Enrollment already used one attempt (activation), leaving four guesses in the window.
      expect(statuses).toEqual([401, 401, 401, 401, 429, 429]);
    });

    it('keeps rate-limit keys in their own namespace without plaintext emails', async () => {
      const redis = new Redis(process.env.TEST_REDIS_URL!);
      try {
        const keys = await redis.keys('rl:*');
        expect(keys.length).toBeGreaterThan(0);
        expect(keys.some((key) => key.includes('@'))).toBe(false);
      } finally {
        redis.disconnect();
      }
    });
  });
});
