import { z } from 'zod';
import { AuthConfig, loadAuthConfig } from './auth-config';
import { loadOrdersConfig, type OrdersConfig } from './orders-config';
import { type FulfillmentConfig, loadFulfillmentConfig } from './fulfillment-config';
import { loadPaymentsConfig, type PaymentsConfig } from './payments-config';
import { loadQueueConfig, type QueueConfig } from './queue-config';
import { readSecret } from './read-secret';

export type ServiceName = 'api' | 'worker' | 'scheduler';

const port = z.coerce.number().int().min(1).max(65535);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  API_PORT: port.default(4000),
  WORKER_HEALTH_PORT: port.default(4001),
  SCHEDULER_HEALTH_PORT: port.default(4002),

  POSTGRES_HOST: z.string().min(1).default('postgres'),
  POSTGRES_PORT: port.default(5432),
  POSTGRES_DB: z.string().min(1).default('robux'),
  POSTGRES_USER: z.string().min(1).default('robux'),

  REDIS_HOST: z.string().min(1).default('redis'),
  REDIS_PORT: port.default(6379),
});

export interface AppConfig {
  service: ServiceName;
  nodeEnv: 'development' | 'test' | 'production';
  logLevel: string;
  apiPort: number;
  healthPort: number;
  databaseUrl: string;
  redis: { host: string; port: number; password: string };
  queue: QueueConfig;
  /** Only the HTTP API handles browser authentication; worker and scheduler get null. */
  auth: AuthConfig | null;
  /** Order creation runs only in the HTTP API. */
  orders: OrdersConfig | null;
  /** Payment creation and gateway callbacks run only in the HTTP API. */
  payments: PaymentsConfig | null;
  /** Loaded by every process, so the production gate on the mock provider stops any of them. */
  fulfillment: FulfillmentConfig;
  /** API-only key for Telegram account inventory payload encryption. */
  accountInventory: { encryptionKey: Buffer; keyVersion: number } | null;
  /** Optional Telegram Bot API configuration. Never required for Core-only deployments. */
  telegram: { botToken: string; webhookSecret: string; miniAppUrl: string } | null;
  /** Treasury monitoring/refill planning only; no Binance withdrawal or wallet signing adapter exists. */
  treasury: {
    enabled: boolean;
    binanceWithdrawalEnabled: false;
    minBalanceNano: bigint;
    targetBalanceNano: bigint;
    maxRefillNano: bigint;
    dailyLimitNano: bigint;
    allowedDestinationAddresses: string[];
  };
}

const MIN_SECRET_LENGTH = 16;

/** Validates the environment once at boot. Error messages never contain secret values. */
export function loadConfig(service: ServiceName, env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  const e = parsed.data;

  const postgresPassword = readSecret(env, 'POSTGRES_PASSWORD');
  const redisPassword = readSecret(env, 'REDIS_PASSWORD');
  if (!postgresPassword || !redisPassword) {
    const missing = [
      !postgresPassword && 'POSTGRES_PASSWORD(_FILE)',
      !redisPassword && 'REDIS_PASSWORD(_FILE)',
    ].filter(Boolean);
    throw new Error(`Invalid configuration: missing secrets ${missing.join(', ')}`);
  }
  if (e.NODE_ENV === 'production') {
    const weak = [
      ['POSTGRES_PASSWORD', postgresPassword],
      ['REDIS_PASSWORD', redisPassword],
    ].filter(([, value]) => (value ?? '').length < MIN_SECRET_LENGTH);
    if (weak.length > 0) {
      const names = weak.map(([name]) => name).join(', ');
      throw new Error(
        `Invalid configuration: ${names} shorter than ${MIN_SECRET_LENGTH} characters`,
      );
    }
  }

  const databaseUrl =
    `postgresql://${encodeURIComponent(e.POSTGRES_USER)}:${encodeURIComponent(postgresPassword)}` +
    `@${e.POSTGRES_HOST}:${e.POSTGRES_PORT}/${encodeURIComponent(e.POSTGRES_DB)}`;

  const healthPort =
    service === 'worker'
      ? e.WORKER_HEALTH_PORT
      : service === 'scheduler'
        ? e.SCHEDULER_HEALTH_PORT
        : e.API_PORT;

  return {
    service,
    nodeEnv: e.NODE_ENV,
    logLevel: e.LOG_LEVEL,
    apiPort: e.API_PORT,
    healthPort,
    databaseUrl,
    redis: { host: e.REDIS_HOST, port: e.REDIS_PORT, password: redisPassword },
    queue: loadQueueConfig(env),
    auth: service === 'api' ? loadAuthConfig(env) : null,
    orders: service === 'api' ? loadOrdersConfig(env) : null,
    payments: service === 'api' ? loadPaymentsConfig(env) : null,
    fulfillment: loadFulfillmentConfig(env),
    accountInventory: service === 'api' ? loadAccountInventoryConfig(env) : null,
    telegram: loadTelegramConfig(env),
    treasury: loadTreasuryConfig(env),
  };
}

export function loadTreasuryConfig(env: NodeJS.ProcessEnv): AppConfig['treasury'] {
  const enabled = env.TON_TREASURY_ENABLED === 'true';
  if (
    enabled &&
    env.NODE_ENV === 'production' &&
    env.TON_TREASURY_PRODUCTION_AUTHORIZED !== 'true'
  ) {
    throw new Error('Invalid configuration: TON treasury production authorization is not enabled');
  }
  if (env.BINANCE_WITHDRAWAL_ENABLED === 'true') {
    throw new Error('Invalid configuration: live Binance withdrawal adapter is not implemented');
  }
  const nano = (name: string, fallback: string) => {
    const value = env[name] ?? fallback;
    if (!/^\d+$/.test(value))
      throw new Error(`Invalid configuration: ${name} must be integer nanoTON`);
    return BigInt(value);
  };
  const minBalanceNano = nano('TON_TREASURY_MIN_BALANCE_NANO', '20000000000');
  const targetBalanceNano = nano('TON_TREASURY_TARGET_BALANCE_NANO', '100000000000');
  const maxRefillNano = nano('TON_TREASURY_MAX_REFILL_NANO', '100000000000');
  const dailyLimitNano = nano('TON_TREASURY_DAILY_LIMIT_NANO', '100000000000');
  if (targetBalanceNano <= minBalanceNano || maxRefillNano <= 0n || dailyLimitNano <= 0n) {
    throw new Error('Invalid configuration: TON treasury thresholds and limits are inconsistent');
  }
  return {
    enabled,
    binanceWithdrawalEnabled: false,
    minBalanceNano,
    targetBalanceNano,
    maxRefillNano,
    dailyLimitNano,
    allowedDestinationAddresses: (env.TON_TREASURY_ALLOWED_ADDRESSES ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  };
}

function loadAccountInventoryConfig(env: NodeJS.ProcessEnv) {
  const secret = readSecret(env, 'ACCOUNT_INVENTORY_ENCRYPTION_KEY');
  if (!secret) {
    throw new Error(
      'Invalid configuration: missing secret ACCOUNT_INVENTORY_ENCRYPTION_KEY(_FILE)',
    );
  }
  const key = Buffer.from(secret, 'hex');
  if (key.length !== 32 || key.toString('hex') !== secret.toLowerCase()) {
    throw new Error(
      'Invalid configuration: ACCOUNT_INVENTORY_ENCRYPTION_KEY must be 64 hex characters',
    );
  }
  return { encryptionKey: key, keyVersion: 1 };
}

function loadTelegramConfig(env: NodeJS.ProcessEnv) {
  const botToken = readSecret(env, 'TELEGRAM_BOT_TOKEN')?.trim();
  if (!botToken) return null;
  const webhookSecret = readSecret(env, 'TELEGRAM_WEBHOOK_SECRET')?.trim();
  const miniAppUrl = env.TELEGRAM_MINI_APP_URL?.trim();
  if (!webhookSecret || webhookSecret.length < 16 || webhookSecret.length > 256) {
    throw new Error('Invalid configuration: TELEGRAM_WEBHOOK_SECRET must be 16..256 characters');
  }
  let parsed: URL;
  try {
    parsed = new URL(miniAppUrl ?? '');
  } catch {
    throw new Error('Invalid configuration: TELEGRAM_MINI_APP_URL must be an absolute URL');
  }
  if (parsed.protocol !== 'https:' && env.NODE_ENV === 'production') {
    throw new Error('Invalid configuration: TELEGRAM_MINI_APP_URL must use https in production');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Invalid configuration: TELEGRAM_MINI_APP_URL must use http(s)');
  }
  return { botToken, webhookSecret, miniAppUrl: parsed.toString() };
}
