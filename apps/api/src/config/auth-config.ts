import { readSecret } from './read-secret';

export interface AuthConfig {
  /** HMAC key for CSRF tokens bound to a session (ADR-008). */
  csrfSecret: string;
  /** AES-256-GCM key for TOTP secrets at rest, with its version for rotation. */
  totpEncryptionKey: Buffer;
  totpEncryptionKeyVersion: number;
  /** Browser origins allowed to make state-changing requests (CSRF) and CORS calls. */
  trustedOrigins: string[];
  /** Cookies are always Secure; `false` exists only for plain-HTTP automated tests. */
  secureCookies: boolean;
}

const MIN_CSRF_SECRET_LENGTH = 32;

export function loadAuthConfig(env: NodeJS.ProcessEnv): AuthConfig {
  const csrfSecret = readSecret(env, 'CSRF_SECRET');
  const totpKeyHex = readSecret(env, 'TOTP_ENCRYPTION_KEY');
  if (!csrfSecret || csrfSecret.length < MIN_CSRF_SECRET_LENGTH) {
    throw new Error(
      `Invalid configuration: CSRF_SECRET(_FILE) must be at least ${MIN_CSRF_SECRET_LENGTH} characters`,
    );
  }
  if (!totpKeyHex || !/^[0-9a-f]{64}$/i.test(totpKeyHex)) {
    throw new Error('Invalid configuration: TOTP_ENCRYPTION_KEY(_FILE) must be 64 hex characters');
  }
  const trustedOrigins = (env.TRUSTED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (trustedOrigins.some((origin) => origin === '*' || !/^https?:\/\/[^/]+$/.test(origin))) {
    throw new Error('Invalid configuration: TRUSTED_ORIGINS must be exact origins, no wildcard');
  }
  const secureCookies = env.SESSION_COOKIE_SECURE !== 'false';
  if (!secureCookies && env.NODE_ENV === 'production') {
    throw new Error(
      'Invalid configuration: SESSION_COOKIE_SECURE=false is not allowed in production',
    );
  }
  return {
    csrfSecret,
    totpEncryptionKey: Buffer.from(totpKeyHex, 'hex'),
    totpEncryptionKeyVersion: Number(env.TOTP_ENCRYPTION_KEY_VERSION ?? '1'),
    trustedOrigins,
    secureCookies,
  };
}
