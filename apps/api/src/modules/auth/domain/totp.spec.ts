import {
  decodeBase32,
  encodeBase32,
  hotp,
  totpProvisioningUri,
  totpStep,
  verifyTotp,
} from './totp';

// RFC 6238 Appendix B, SHA-1 seed. The RFC lists 8-digit values; 6-digit codes are their last 6 digits.
const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii');
const RFC_VECTORS: [number, string][] = [
  [59, '287082'],
  [1111111109, '081804'],
  [1234567890, '005924'],
  [2000000000, '279037'],
];

describe('TOTP', () => {
  it.each(RFC_VECTORS)('matches the RFC 6238 vector at t=%i', (seconds, expected) => {
    expect(hotp(RFC_SECRET, totpStep(new Date(seconds * 1000)))).toBe(expected);
  });

  it('accepts the current code and one step of clock drift', () => {
    const now = new Date(1_234_567_890_000);
    const step = totpStep(now);
    expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step), now, null)).toBe(step);
    expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step - 1), now, null)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step + 2), now, null)).toBeNull();
  });

  it('rejects a code whose step was already used (replay)', () => {
    const now = new Date(1_234_567_890_000);
    const step = totpStep(now);
    expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step), now, step)).toBeNull();
  });

  it('rejects malformed codes', () => {
    expect(verifyTotp(RFC_SECRET, '12345', new Date(), null)).toBeNull();
    expect(verifyTotp(RFC_SECRET, 'abcdef', new Date(), null)).toBeNull();
  });

  it('round-trips base32 and matches the RFC 4648 example', () => {
    expect(encodeBase32(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(decodeBase32('MZXW6YTBOI').toString()).toBe('foobar');
    expect(decodeBase32(encodeBase32(RFC_SECRET)).equals(RFC_SECRET)).toBe(true);
  });

  it('builds a standard otpauth URI', () => {
    const uri = totpProvisioningUri(RFC_SECRET, 'admin@example.test', 'Top Up Robux Admin');
    expect(uri).toMatch(/^otpauth:\/\/totp\/Top%20Up%20Robux%20Admin%3Aadmin%40example\.test\?/);
    expect(uri).toContain(`secret=${encodeBase32(RFC_SECRET)}`);
    expect(uri).toContain('digits=6');
  });
});
