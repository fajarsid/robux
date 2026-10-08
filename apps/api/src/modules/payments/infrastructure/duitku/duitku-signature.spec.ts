import { constantTimeEquals, duitkuSignature } from './duitku-signature';

describe('duitkuSignature', () => {
  it('is lowercase hex HMAC-SHA256 over the concatenated parts', () => {
    // Published HMAC-SHA256 test value for key "key" and this message.
    expect(duitkuSignature('key', 'The quick brown fox ', 'jumps over the lazy dog')).toBe(
      'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8',
    );
  });
});

describe('constantTimeEquals', () => {
  it('compares strings of any length', () => {
    expect(constantTimeEquals('abc', 'abc')).toBe(true);
    expect(constantTimeEquals('abc', 'abd')).toBe(false);
    expect(constantTimeEquals('abc', 'abcd')).toBe(false);
  });
});
