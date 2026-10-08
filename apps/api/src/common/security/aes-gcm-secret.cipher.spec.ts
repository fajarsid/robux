import { randomBytes } from 'node:crypto';
import { AesGcmSecretCipher } from './aes-gcm-secret.cipher';

describe('AesGcmSecretCipher', () => {
  const cipher = new AesGcmSecretCipher(randomBytes(32), 1);

  it('round-trips and never produces the same ciphertext twice', () => {
    const secret = randomBytes(20);
    const first = cipher.encrypt(secret);
    const second = cipher.encrypt(secret);
    expect(first.equals(second)).toBe(false);
    expect(cipher.decrypt(first, 1).equals(secret)).toBe(true);
  });

  it('detects tampering', () => {
    const payload = cipher.encrypt(randomBytes(20));
    payload[payload.length - 1]! ^= 0xff;
    expect(() => cipher.decrypt(payload, 1)).toThrow();
  });

  it('refuses a ciphertext from another key version', () => {
    expect(() => cipher.decrypt(cipher.encrypt(randomBytes(20)), 2)).toThrow(/version 2/);
  });
});
