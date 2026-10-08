import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from './app-config';

function secretFile(value: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
  const file = join(dir, 'secret.txt');
  writeFileSync(file, `${value}\n`);
  return file;
}

describe('loadConfig', () => {
  const baseEnv = {
    POSTGRES_PASSWORD: 'pg-pass',
    REDIS_PASSWORD: 'redis-pass',
    CSRF_SECRET: 'c'.repeat(32),
    TOTP_ENCRYPTION_KEY: 'a'.repeat(64),
    IDEMPOTENCY_ENCRYPTION_KEY: 'b'.repeat(64),
    ACCOUNT_INVENTORY_ENCRYPTION_KEY: 'd'.repeat(64),
  };

  it('builds a database URL with an encoded password', () => {
    const config = loadConfig('api', { ...baseEnv, POSTGRES_PASSWORD: 'p@ss/word' });
    expect(config.databaseUrl).toBe('postgresql://robux:p%40ss%2Fword@postgres:5432/robux');
  });

  it('reads secrets from *_FILE and strips the trailing newline', () => {
    const config = loadConfig('worker', {
      POSTGRES_PASSWORD_FILE: secretFile('from-file-pg'),
      REDIS_PASSWORD_FILE: secretFile('from-file-redis'),
    });
    expect(config.redis.password).toBe('from-file-redis');
    expect(config.databaseUrl).toContain(':from-file-pg@');
  });

  it('prefers the secret file over the plain variable', () => {
    const config = loadConfig('api', {
      ...baseEnv,
      REDIS_PASSWORD_FILE: secretFile('file-wins'),
    });
    expect(config.redis.password).toBe('file-wins');
  });

  it('fails fast when secrets are missing, without echoing values', () => {
    expect(() => loadConfig('api', { POSTGRES_PASSWORD: 'x' })).toThrow(/REDIS_PASSWORD/);
  });

  it('rejects short secrets in production', () => {
    expect(() => loadConfig('api', { ...baseEnv, NODE_ENV: 'production' })).toThrow(
      /shorter than 16/,
    );
  });

  it('selects the health port per service', () => {
    expect(loadConfig('api', baseEnv).healthPort).toBe(4000);
    expect(loadConfig('api', baseEnv).accountInventory?.encryptionKey).toHaveLength(32);
    expect(loadConfig('worker', baseEnv).healthPort).toBe(4001);
    expect(loadConfig('worker', baseEnv).accountInventory).toBeNull();
    expect(loadConfig('scheduler', baseEnv).healthPort).toBe(4002);
  });

  it('parses exact trusted origins for the API', () => {
    const config = loadConfig('api', {
      ...baseEnv,
      TRUSTED_ORIGINS: 'https://app.example.com, http://app.localhost:8088',
    });
    expect(config.auth?.trustedOrigins).toEqual([
      'https://app.example.com',
      'http://app.localhost:8088',
    ]);
  });

  it('rejects wildcard or path-bearing trusted origins', () => {
    expect(() => loadConfig('api', { ...baseEnv, TRUSTED_ORIGINS: '*' })).toThrow(/no wildcard/);
    expect(() =>
      loadConfig('api', { ...baseEnv, TRUSTED_ORIGINS: 'https://app.example.com/path' }),
    ).toThrow(/exact origins/);
  });

  it('requires auth secrets for the API but not for background processes', () => {
    const withoutCsrf = { ...baseEnv, CSRF_SECRET: '' };
    expect(() => loadConfig('api', withoutCsrf)).toThrow(/CSRF_SECRET/);
    expect(() => loadConfig('api', { ...baseEnv, TOTP_ENCRYPTION_KEY: 'short' })).toThrow(
      /TOTP_ENCRYPTION_KEY/,
    );
    expect(loadConfig('worker', withoutCsrf).auth).toBeNull();
  });

  it('never allows insecure session cookies in production', () => {
    const strong = {
      ...baseEnv,
      POSTGRES_PASSWORD: 'p'.repeat(32),
      REDIS_PASSWORD: 'r'.repeat(32),
    };
    expect(() =>
      loadConfig('api', { ...strong, NODE_ENV: 'production', SESSION_COOKIE_SECURE: 'false' }),
    ).toThrow(/SESSION_COOKIE_SECURE/);
    expect(loadConfig('api', strong).auth?.secureCookies).toBe(true);
  });

  it('rejects invalid ports', () => {
    expect(() => loadConfig('api', { ...baseEnv, API_PORT: '70000' })).toThrow(/API_PORT/);
  });
});
