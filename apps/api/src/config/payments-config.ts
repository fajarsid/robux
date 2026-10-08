import { readSecret } from './read-secret';

export interface DuitkuConfig {
  environment: 'sandbox' | 'production';
  merchantCode: string;
  apiKey: string;
  /** Our public webhook endpoint, sent with every inquiry. */
  callbackUrl: string;
  /** Where Duitku sends the customer back; that page only reads status from our API. */
  returnUrl: string;
  /** Codes enabled in the Duitku project; each must be one the adapter supports. */
  paymentMethods: string[];
  /** Optional defence in depth (docs/integrations/duitku.md §4); empty means not enforced. */
  callbackAllowedIps: string[];
  requestTimeoutMs: number;
}

/** `none` keeps the storefront running with payment intake switched off (no fake gateway). */
export interface PaymentsConfig {
  gateway: 'duitku' | 'mock' | 'none';
  duitku: DuitkuConfig | null;
  telegramStarsEnabled: boolean;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

const list = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

function publicUrl(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  let url: URL;
  try {
    url = new URL(value ?? '');
  } catch {
    throw new Error(`Invalid configuration: ${name} must be an absolute URL`);
  }
  if (env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error(`Invalid configuration: ${name} must use https in production`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`Invalid configuration: ${name} must be http(s)`);
  }
  return url.toString();
}

export function loadPaymentsConfig(env: NodeJS.ProcessEnv): PaymentsConfig {
  const gateway = env.PAYMENT_GATEWAY ?? 'none';
  const telegramStarsEnabled = env.PAYMENT_PROVIDER_STARS_ENABLED === 'true';
  if (
    telegramStarsEnabled &&
    env.NODE_ENV === 'production' &&
    env.TELEGRAM_STARS_PRODUCTION_AUTHORIZED !== 'true'
  ) {
    throw new Error(
      'Invalid configuration: Telegram Stars production authorization is not enabled',
    );
  }
  if (gateway === 'none') {
    return { gateway, duitku: null, telegramStarsEnabled };
  }
  if (gateway === 'mock') {
    if (env.NODE_ENV === 'production') {
      throw new Error('Invalid configuration: PAYMENT_GATEWAY=mock is forbidden in production');
    }
    return { gateway, duitku: null, telegramStarsEnabled };
  }
  if (gateway !== 'duitku') {
    throw new Error('Invalid configuration: PAYMENT_GATEWAY must be duitku, mock or none');
  }

  const environment = env.DUITKU_ENVIRONMENT;
  if (environment !== 'sandbox' && environment !== 'production') {
    throw new Error('Invalid configuration: DUITKU_ENVIRONMENT must be sandbox or production');
  }
  const merchantCode = readSecret(env, 'DUITKU_MERCHANT_CODE')?.trim();
  const apiKey = readSecret(env, 'DUITKU_API_KEY')?.trim();
  if (!merchantCode || !apiKey) {
    throw new Error(
      'Invalid configuration: DUITKU_MERCHANT_CODE(_FILE) and DUITKU_API_KEY(_FILE) are required',
    );
  }
  const paymentMethods = list(env.DUITKU_PAYMENT_METHODS);
  if (paymentMethods.length === 0) {
    throw new Error('Invalid configuration: DUITKU_PAYMENT_METHODS needs at least one code');
  }
  const requestTimeoutMs = Number(env.DUITKU_REQUEST_TIMEOUT_MS ?? DEFAULT_REQUEST_TIMEOUT_MS);
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1000 || requestTimeoutMs > 60_000) {
    throw new Error('Invalid configuration: DUITKU_REQUEST_TIMEOUT_MS must be 1000..60000');
  }

  return {
    gateway,
    telegramStarsEnabled,
    duitku: {
      environment,
      merchantCode,
      apiKey,
      callbackUrl: publicUrl(env, 'DUITKU_CALLBACK_URL'),
      returnUrl: publicUrl(env, 'DUITKU_RETURN_URL'),
      paymentMethods,
      callbackAllowedIps: list(env.DUITKU_CALLBACK_ALLOWED_IPS),
      requestTimeoutMs,
    },
  };
}
