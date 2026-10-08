import { idempotencyScope, requestFingerprint } from './order-idempotency';

describe('order idempotency', () => {
  it('scopes keys per customer, with all guests sharing one scope', () => {
    expect(idempotencyScope('u-1')).toBe('orders.create:customer:u-1');
    expect(idempotencyScope('u-2')).not.toBe(idempotencyScope('u-1'));
    expect(idempotencyScope(undefined)).toBe('orders.create:guest');
  });

  it('fingerprints requests independently of key order and undefined fields', () => {
    const a = {
      productId: 'p',
      quantity: 2,
      recipient: { robloxUsername: 'Abc' },
      note: undefined,
    };
    const b = { recipient: { robloxUsername: 'Abc' }, quantity: 2, productId: 'p' };
    expect(requestFingerprint(a)).toBe(requestFingerprint(b));
    expect(requestFingerprint(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes the fingerprint when anything that was asked for changes', () => {
    const base = { productId: 'p', quantity: 2, recipient: { robloxUsername: 'Abc' } };
    const fingerprint = requestFingerprint(base);
    expect(requestFingerprint({ ...base, quantity: 3 })).not.toBe(fingerprint);
    expect(requestFingerprint({ ...base, recipient: { robloxUsername: 'Abd' } })).not.toBe(
      fingerprint,
    );
    expect(requestFingerprint({ ...base, quantity: '2' })).not.toBe(fingerprint);
  });
});
