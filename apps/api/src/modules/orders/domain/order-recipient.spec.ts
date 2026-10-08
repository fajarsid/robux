import { createOrderRequestSchema, PRODUCT_LINES } from '@robux/shared';
import { DomainError } from '../../../common/errors/domain-error';
import { productFulfillmentOf, productLineProfile } from '../../products/domain/product-line';
import { resolveOrderRecipient } from './order-recipient';

describe('product lines (ADR-009)', () => {
  it('map to the agreed platform, fulfillment type, recipient and unit', () => {
    expect(PRODUCT_LINES.map((line) => [line, productLineProfile(line)])).toEqual([
      [
        'ROBLOX_ROBUX',
        {
          platform: 'ROBLOX',
          fulfillmentType: 'BALANCE_PURCHASE',
          recipientType: 'ROBLOX_USER',
          unit: 'ROBUX',
        },
      ],
      [
        'TELEGRAM_PREMIUM',
        {
          platform: 'TELEGRAM',
          fulfillmentType: 'RECIPIENT_FULFILLMENT',
          recipientType: 'TELEGRAM_USER',
          unit: 'PREMIUM_MONTH',
        },
      ],
      [
        'TELEGRAM_STARS',
        {
          platform: 'TELEGRAM',
          fulfillmentType: 'RECIPIENT_FULFILLMENT',
          recipientType: 'TELEGRAM_USER',
          unit: 'STAR',
        },
      ],
      [
        'TELEGRAM_ACCOUNT',
        {
          platform: 'TELEGRAM',
          fulfillmentType: 'DIGITAL_DELIVERY',
          recipientType: null,
          unit: 'ACCOUNT',
        },
      ],
    ]);
    expect(productFulfillmentOf('TELEGRAM_STARS').productLine).toBe('TELEGRAM_STARS');
  });
});

describe('resolveOrderRecipient', () => {
  const rejects = (fn: () => unknown) =>
    expect(fn).toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }) as unknown as DomainError,
    );

  it('Robux needs a Roblox username', () => {
    expect(resolveOrderRecipient('ROBLOX_USER', { robloxUsername: 'Builder_Kid' })).toEqual({
      type: 'ROBLOX_USER',
      identifier: 'Builder_Kid',
    });
    rejects(() => resolveOrderRecipient('ROBLOX_USER', { telegramUsername: 'durov' }));
    rejects(() => resolveOrderRecipient('ROBLOX_USER', undefined));
  });

  it('Telegram Premium and Stars need a Telegram username', () => {
    expect(resolveOrderRecipient('TELEGRAM_USER', { telegramUsername: 'durov' })).toEqual({
      type: 'TELEGRAM_USER',
      identifier: 'durov',
    });
    rejects(() => resolveOrderRecipient('TELEGRAM_USER', { robloxUsername: 'Builder_Kid' }));
    rejects(() => resolveOrderRecipient('TELEGRAM_USER', undefined));
  });

  it('Telegram accounts take no recipient at all', () => {
    expect(resolveOrderRecipient(null, undefined)).toBeNull();
    rejects(() => resolveOrderRecipient(null, { telegramUsername: 'durov' }));
  });
});

describe('createOrderRequestSchema', () => {
  const base = {
    productId: '0192f0a0-0000-7000-8000-000000000001',
    quantity: 1,
    priceVersionId: '0192f0a0-0000-7000-8000-000000000002',
  };

  it('keeps the existing Robux request shape', () => {
    expect(
      createOrderRequestSchema.safeParse({ ...base, recipient: { robloxUsername: 'Builder_Kid' } })
        .success,
    ).toBe(true);
  });

  it('accepts a Telegram username, removing a leading @', () => {
    const parsed = createOrderRequestSchema.parse({
      ...base,
      recipient: { telegramUsername: '@durov_team' },
    });
    expect(parsed.recipient).toEqual({ telegramUsername: 'durov_team' });
    for (const bad of ['abc', '1durov', 'du-rov', 'a'.repeat(33)]) {
      expect(
        createOrderRequestSchema.safeParse({ ...base, recipient: { telegramUsername: bad } })
          .success,
      ).toBe(false);
    }
  });

  it('never lets the client choose a fulfillment type, platform or product line', () => {
    for (const extra of [
      { fulfillmentType: 'DIGITAL_DELIVERY' },
      { platform: 'TELEGRAM' },
      { productLine: 'TELEGRAM_ACCOUNT' },
    ]) {
      expect(createOrderRequestSchema.safeParse({ ...base, ...extra }).success).toBe(false);
    }
    expect(
      createOrderRequestSchema.safeParse({
        ...base,
        recipient: { robloxUsername: 'Builder_Kid', telegramUsername: 'durov' },
      }).success,
    ).toBe(false);
  });

  it('allows no recipient (digital delivery); the API decides whether the product needs one', () => {
    expect(createOrderRequestSchema.safeParse(base).success).toBe(true);
  });
});
