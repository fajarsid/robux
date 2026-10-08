import { randomBytes } from 'node:crypto';
import type { OrderCreatedView } from '@robux/shared';
import { AesGcmSecretCipher } from '../../../common/security/aes-gcm-secret.cipher';
import { ReplayableResponseCodec } from './replayable-response.codec';

const view: Omit<OrderCreatedView, 'orderId'> = {
  orderNumber: 'RBX-20261005-00001',
  trackingToken: 'tracking-token-value-that-must-not-be-stored',
  stage: 'AWAITING_PAYMENT',
  pricing: {
    currency: 'IDR',
    unitPrice: '69000.00',
    quantity: 1,
    subtotal: '69000.00',
    discount: '0.00',
    fee: '0.00',
    tax: '0.00',
    total: '69000.00',
  },
  recipientUsername: 'TestPlayer',
  paymentExpiresAt: '2026-10-05T13:00:00.000Z',
};

const codecWithFreshKey = () =>
  new ReplayableResponseCodec(new AesGcmSecretCipher(randomBytes(32), 1));

describe('ReplayableResponseCodec', () => {
  const codec = codecWithFreshKey();

  it('never stores the tracking token in plaintext', () => {
    const sealed = codec.seal(view);
    expect(JSON.stringify(sealed)).not.toContain(view.trackingToken);
    expect(sealed).not.toHaveProperty('trackingToken');
  });

  it('returns the original response when opened', () => {
    expect(codec.open(codec.seal(view))).toEqual(view);
  });

  it('cannot be opened with a different key', () => {
    expect(() => codecWithFreshKey().open(codec.seal(view))).toThrow();
  });
});
