import {
  generateGuestTrackingToken,
  hashGuestTrackingToken,
  isWellFormedGuestTrackingToken,
} from './guest-tracking-token';

describe('guest tracking token', () => {
  it('produces a 256-bit base64url token and its SHA-256 hex hash', () => {
    const { token, hash } = generateGuestTrackingToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashGuestTrackingToken(token)).toBe(hash);
  });

  it('never repeats across many generations', () => {
    const tokens = new Set(
      Array.from({ length: 10_000 }, () => generateGuestTrackingToken().token),
    );
    expect(tokens.size).toBe(10_000);
  });

  it('recognises only well-formed tokens', () => {
    expect(isWellFormedGuestTrackingToken(generateGuestTrackingToken().token)).toBe(true);
    expect(isWellFormedGuestTrackingToken('RBX-20261005-00001')).toBe(false);
    expect(isWellFormedGuestTrackingToken('a'.repeat(44))).toBe(false);
  });
});
