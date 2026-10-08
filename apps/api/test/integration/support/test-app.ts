import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { loadConfig } from '../../../src/config/app-config';
import { configureHttpApp } from '../../../src/configure-http-app';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import type { UserRole } from '../../../src/generated/prisma/enums';
import { Argon2PasswordHasher } from '../../../src/modules/auth/infrastructure/argon2-password.hasher';
import { decodeBase32, hotp, totpStep } from '../../../src/modules/auth/domain/totp';
import { testDatabaseUrl } from './test-database';

export const TRUSTED_ORIGIN = 'http://app.test';
export const TEST_PASSWORD = 'correct-horse-battery';

// Generated per test run, so no secret-shaped literal lives in the repository.
const TEST_RUN_CSRF_SECRET = randomBytes(32).toString('hex');
const TEST_RUN_TOTP_KEY = randomBytes(32).toString('hex');

/** A password guaranteed to differ from TEST_PASSWORD. */
export function wrongPassword(): string {
  return `wrong-${randomUUID()}`;
}

function containerEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  const db = new URL(testDatabaseUrl());
  const redisUrl = process.env.TEST_REDIS_URL;
  if (!redisUrl) {
    throw new Error('TEST_REDIS_URL is not set; run through jest.integration.config.js');
  }
  const redis = new URL(redisUrl);
  return {
    NODE_ENV: 'test',
    LOG_LEVEL: 'fatal',
    POSTGRES_HOST: db.hostname,
    POSTGRES_PORT: db.port,
    POSTGRES_DB: db.pathname.slice(1),
    POSTGRES_USER: decodeURIComponent(db.username),
    POSTGRES_PASSWORD: decodeURIComponent(db.password),
    REDIS_HOST: redis.hostname,
    REDIS_PORT: redis.port,
    REDIS_PASSWORD: decodeURIComponent(redis.password),
    CSRF_SECRET: TEST_RUN_CSRF_SECRET,
    TOTP_ENCRYPTION_KEY: TEST_RUN_TOTP_KEY,
    IDEMPOTENCY_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    ACCOUNT_INVENTORY_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    TRUSTED_ORIGINS: TRUSTED_ORIGIN,
    // supertest speaks plain HTTP; one test boots with secure cookies to check the cookie flags.
    SESSION_COOKIE_SECURE: 'false',
    ...overrides,
  };
}

/** `customize` replaces providers, e.g. an external adapter wired to a local stub. */
export async function createTestApp(
  overrides: Record<string, string> = {},
  customize: (builder: TestingModuleBuilder) => TestingModuleBuilder = (builder) => builder,
): Promise<NestExpressApplication> {
  const config = loadConfig('api', containerEnv(overrides));
  const moduleRef = await customize(
    Test.createTestingModule({ imports: [AppModule.forRoot(config)] }),
  ).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureHttpApp(app, config);
  await app.init();
  return app;
}

export function randomTestIp(): string {
  return `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
}

/** Creates a user directly in the database with TEST_PASSWORD. */
export async function createUser(
  prisma: PrismaClient,
  role: UserRole,
  emailPrefix = role.toLowerCase(),
) {
  return prisma.user.create({
    data: {
      email: `${emailPrefix}-${randomUUID().slice(0, 8)}@example.test`,
      role,
      passwordHash: await new Argon2PasswordHasher().hash(TEST_PASSWORD),
    },
  });
}

export function totpCodeFor(base32Secret: string, stepOffset = 0): string {
  return hotp(decodeBase32(base32Secret), totpStep(new Date()) + stepOffset);
}

interface RequestOptions {
  origin?: string | null;
  csrf?: boolean;
  headers?: Record<string, string>;
}

interface SessionState {
  authenticated: boolean;
  csrfToken?: string;
  twoFactor?: string;
  expiresAt?: string;
  user?: { id: string; role: string };
}

/**
 * Behaves like one browser: keeps the session cookie, sends the trusted Origin and the CSRF token,
 * and uses its own client IP so rate limits of different tests do not interfere.
 */
export class TestBrowser {
  cookie?: string;
  csrfToken?: string;
  readonly ip = randomTestIp();

  constructor(private readonly app: NestExpressApplication) {}

  private decorate(test: request.Test, options: RequestOptions = {}) {
    test.set('X-Forwarded-For', this.ip);
    for (const [name, value] of Object.entries(options.headers ?? {})) {
      test.set(name, value);
    }
    if (options.origin !== null) {
      test.set('Origin', options.origin ?? TRUSTED_ORIGIN);
    }
    if (this.cookie) {
      test.set('Cookie', this.cookie);
    }
    if (options.csrf !== false && this.csrfToken) {
      test.set('X-CSRF-Token', this.csrfToken);
    }
    return test;
  }

  private capture(response: request.Response): request.Response {
    const setCookie = response.headers['set-cookie'] as unknown as string[] | undefined;
    for (const header of setCookie ?? []) {
      const [pair] = header.split(';');
      if (pair?.startsWith('sid=')) {
        this.cookie = pair.endsWith('=') ? undefined : pair;
      }
    }
    return response;
  }

  async get(path: string) {
    return this.capture(await this.decorate(request(this.app.getHttpServer()).get(path)));
  }

  async send(
    method: 'post' | 'patch' | 'delete',
    path: string,
    body?: object | string,
    options?: RequestOptions,
  ) {
    const test = this.decorate(request(this.app.getHttpServer())[method](path), options);
    return this.capture(await (body ? test.send(body) : test));
  }

  async refreshSession(): Promise<SessionState> {
    const response = await this.get('/api/v1/auth/session');
    const session = response.body as SessionState;
    this.csrfToken = session.csrfToken;
    return session;
  }

  async login(email: string, password = TEST_PASSWORD, portal: 'customer' | 'staff' = 'customer') {
    const path = portal === 'staff' ? '/api/v1/admin/auth/login' : '/api/v1/auth/login';
    const response = await this.send('post', path, { email, password });
    await this.refreshSession();
    return response;
  }

  /** Staff login including first-time TOTP enrollment; returns the TOTP secret and recovery codes. */
  async loginStaffWithEnrollment(email: string) {
    await this.login(email, TEST_PASSWORD, 'staff');
    const setup = await this.send('post', '/api/v1/admin/auth/2fa/setup');
    const secret = setup.body.secret as string;
    const activation = await this.send('post', '/api/v1/admin/auth/2fa/activate', {
      code: totpCodeFor(secret),
    });
    await this.refreshSession();
    return { secret, recoveryCodes: activation.body.recoveryCodes as string[] };
  }
}

/** A fully signed-in browser for a new user of `role` (staff complete TOTP enrollment). */
export async function signInAs(app: NestExpressApplication, prisma: PrismaClient, role: UserRole) {
  const user = await createUser(prisma, role);
  const browser = new TestBrowser(app);
  if (role === 'CUSTOMER') {
    await browser.login(user.email);
  } else {
    await browser.loginStaffWithEnrollment(user.email);
  }
  return { user, browser };
}
