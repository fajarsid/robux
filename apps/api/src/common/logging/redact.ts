/**
 * Paths removed from every log line (SECURITY.md §9). Pino matches exact paths, so each
 * sensitive key is listed at the top level and one or two levels deep.
 */
const SENSITIVE_KEYS = [
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'apiKey',
  'signature',
  'totp',
  'recoveryCode',
  'recoveryCodes',
  'trackingToken',
  'sessionToken',
  'csrfToken',
  'idempotencyKey',
  'credential',
  'credentials',
  'cookie',
  'authorization',
];

export const REDACT_PATHS: string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["x-csrf-token"]',
  'req.headers["idempotency-key"]',
  'res.headers["set-cookie"]',
  ...SENSITIVE_KEYS,
  ...SENSITIVE_KEYS.map((k) => `*.${k}`),
  ...SENSITIVE_KEYS.map((k) => `*.*.${k}`),
];

export const REDACT_CENSOR = '[REDACTED]';
