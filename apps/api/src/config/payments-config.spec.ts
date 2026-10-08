import { loadPaymentsConfig } from './payments-config';

const duitkuEnv = {
  PAYMENT_GATEWAY: 'duitku',
  DUITKU_ENVIRONMENT: 'sandbox',
  DUITKU_MERCHANT_CODE: 'DTEST',
  DUITKU_API_KEY: 'k'.repeat(32),
  DUITKU_CALLBACK_URL: 'https://api.example.test/api/v1/webhooks/payments/duitku',
  DUITKU_RETURN_URL: 'https://app.example.test/payment/return',
  DUITKU_PAYMENT_METHODS: 'BC, SP',
};

describe('loadPaymentsConfig', () => {
  it('switches payment intake off by default', () => {
    expect(loadPaymentsConfig({})).toEqual({
      gateway: 'none',
      duitku: null,
      telegramStarsEnabled: false,
    });
  });

  it('enables a development-only mock gateway', () => {
    expect(loadPaymentsConfig({ PAYMENT_GATEWAY: 'mock', NODE_ENV: 'test' })).toEqual({
      gateway: 'mock',
      duitku: null,
      telegramStarsEnabled: false,
    });
    expect(() => loadPaymentsConfig({ PAYMENT_GATEWAY: 'mock', NODE_ENV: 'production' })).toThrow(
      /forbidden in production/,
    );
  });

  it('loads Duitku settings', () => {
    expect(
      loadPaymentsConfig({ ...duitkuEnv, DUITKU_CALLBACK_ALLOWED_IPS: '182.23.85.11' }),
    ).toEqual({
      gateway: 'duitku',
      telegramStarsEnabled: false,
      duitku: {
        environment: 'sandbox',
        merchantCode: 'DTEST',
        apiKey: 'k'.repeat(32),
        callbackUrl: duitkuEnv.DUITKU_CALLBACK_URL,
        returnUrl: duitkuEnv.DUITKU_RETURN_URL,
        paymentMethods: ['BC', 'SP'],
        callbackAllowedIps: ['182.23.85.11'],
        requestTimeoutMs: 15_000,
      },
    });
  });

  it('enables Stars only with an explicit switch and requires a production authorization gate', () => {
    expect(
      loadPaymentsConfig({ PAYMENT_PROVIDER_STARS_ENABLED: 'true', NODE_ENV: 'test' }),
    ).toMatchObject({ telegramStarsEnabled: true });
    expect(() =>
      loadPaymentsConfig({ PAYMENT_PROVIDER_STARS_ENABLED: 'true', NODE_ENV: 'production' }),
    ).toThrow(/production authorization/);
    expect(
      loadPaymentsConfig({
        PAYMENT_PROVIDER_STARS_ENABLED: 'true',
        TELEGRAM_STARS_PRODUCTION_AUTHORIZED: 'true',
        NODE_ENV: 'production',
      }),
    ).toMatchObject({ telegramStarsEnabled: true });
  });

  it.each([
    ['an unknown gateway', { PAYMENT_GATEWAY: 'unsupported' }, /duitku, mock or none/],
    ['a missing environment', { DUITKU_ENVIRONMENT: undefined }, /DUITKU_ENVIRONMENT/],
    ['a missing API key', { DUITKU_API_KEY: '' }, /DUITKU_API_KEY/],
    ['no payment methods', { DUITKU_PAYMENT_METHODS: ' ' }, /DUITKU_PAYMENT_METHODS/],
    ['a relative callback URL', { DUITKU_CALLBACK_URL: '/callback' }, /DUITKU_CALLBACK_URL/],
    ['an out-of-range timeout', { DUITKU_REQUEST_TIMEOUT_MS: '10' }, /TIMEOUT/],
  ])('rejects %s', (_name, overrides, message) => {
    expect(() => loadPaymentsConfig({ ...duitkuEnv, ...overrides })).toThrow(message);
  });

  it('requires https URLs in production', () => {
    expect(() =>
      loadPaymentsConfig({
        ...duitkuEnv,
        NODE_ENV: 'production',
        DUITKU_RETURN_URL: 'http://app.example.test/payment/return',
      }),
    ).toThrow(/https/);
  });

  it('never puts the API key in an error message', () => {
    try {
      loadPaymentsConfig({ ...duitkuEnv, DUITKU_PAYMENT_METHODS: '' });
    } catch (error) {
      expect(String(error)).not.toContain('k'.repeat(32));
    }
  });
});
