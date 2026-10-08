import type { DuitkuConfig } from '../../../../config/payments-config';
import { CallbackRejectedError, type RawCallback } from '../../domain/payment-gateway';
import { parseDuitkuCallback } from './duitku-callback.parser';
import { duitkuSignature } from './duitku-signature';

const config: DuitkuConfig = {
  environment: 'sandbox',
  merchantCode: 'DTEST',
  apiKey: 'unit-test-key',
  callbackUrl: 'https://api.example.test/api/v1/webhooks/payments/duitku',
  returnUrl: 'https://app.example.test/payment/return',
  paymentMethods: ['BC'],
  callbackAllowedIps: [],
  requestTimeoutMs: 5000,
};

function callback(
  fields: Record<string, unknown> = {},
  extra: Partial<RawCallback> = {},
): RawCallback {
  const base = {
    merchantCode: 'DTEST',
    amount: '138000',
    merchantOrderId: 'RBX-20261005-00001-1',
    paymentCode: 'BC',
    resultCode: '00',
    reference: 'DTESTREF1',
    merchantUserId: 'buyer@example.test',
    customerName: 'Bud**** Sant***',
    publisherOrderId: 'PUB1',
  };
  const merged = { ...base, ...fields };
  return {
    contentType: 'application/x-www-form-urlencoded; charset=utf-8',
    sourceIp: '182.23.85.11',
    fields: {
      signature: duitkuSignature('unit-test-key', 'DTEST', '138000', 'RBX-20261005-00001-1'),
      ...merged,
    },
    ...extra,
  };
}

function rejection(raw: RawCallback, cfg: DuitkuConfig = config) {
  try {
    parseDuitkuCallback(cfg, raw);
  } catch (error) {
    return (error as CallbackRejectedError).rejection;
  }
  return undefined;
}

describe('parseDuitkuCallback', () => {
  it('accepts a correctly signed callback and keeps no signature or customer data', () => {
    const verified = parseDuitkuCallback(config, callback());
    expect(verified).toEqual({
      merchantOrderId: 'RBX-20261005-00001-1',
      gatewayReference: 'DTESTREF1',
      amount: '138000',
      paymentMethod: 'BC',
      eventKey: 'RBX-20261005-00001-1:DTESTREF1:00',
      payload: {
        merchantCode: 'DTEST',
        amount: '138000',
        merchantOrderId: 'RBX-20261005-00001-1',
        resultCode: '00',
        reference: 'DTESTREF1',
        paymentCode: 'BC',
        publisherOrderId: 'PUB1',
      },
    });
  });

  it('accepts an uppercase hex signature', () => {
    const raw = callback();
    raw.fields.signature = String(raw.fields.signature).toUpperCase();
    expect(() => parseDuitkuCallback(config, raw)).not.toThrow();
  });

  it('gives different result codes different event keys', () => {
    expect(parseDuitkuCallback(config, callback({ resultCode: '01' })).eventKey).toBe(
      'RBX-20261005-00001-1:DTESTREF1:01',
    );
  });

  it.each([
    ['a missing signature', { signature: undefined }],
    ['a missing amount', { amount: undefined }],
    ['a non-numeric amount', { amount: '1e5' }],
    ['a missing reference', { reference: undefined }],
    ['an array field', { merchantOrderId: ['a', 'b'] }],
    ['a short signature', { signature: 'abc' }],
  ])('rejects %s as malformed', (_name, fields) => {
    expect(rejection(callback(fields))).toBe('MALFORMED');
  });

  it('rejects a non-form content type', () => {
    expect(rejection(callback({}, { contentType: 'application/json' }))).toBe('MALFORMED');
  });

  it('rejects a signature made with another key', () => {
    const forged = callback({
      signature: duitkuSignature('other-key', 'DTEST', '138000', 'RBX-20261005-00001-1'),
    });
    expect(rejection(forged)).toBe('SIGNATURE_INVALID');
  });

  it('rejects a changed amount under the original signature', () => {
    expect(rejection(callback({ amount: '1000' }))).toBe('SIGNATURE_INVALID');
  });

  it('rejects another merchant code even when the signature matches it', () => {
    const otherMerchant = callback({
      merchantCode: 'DOTHER',
      signature: duitkuSignature('unit-test-key', 'DOTHER', '138000', 'RBX-20261005-00001-1'),
    });
    expect(rejection(otherMerchant)).toBe('SIGNATURE_INVALID');
  });

  it('enforces the source allow-list when configured', () => {
    const listed = { ...config, callbackAllowedIps: ['182.23.85.11'] };
    expect(rejection(callback({}, { sourceIp: '::ffff:182.23.85.11' }), listed)).toBeUndefined();
    expect(rejection(callback({}, { sourceIp: '198.51.100.7' }), listed)).toBe(
      'SOURCE_NOT_ALLOWED',
    );
  });
});
