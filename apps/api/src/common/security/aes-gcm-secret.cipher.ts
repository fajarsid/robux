import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface SecretCipher {
  readonly keyVersion: number;
  encrypt(plaintext: Buffer): Buffer;
  decrypt(ciphertext: Buffer, keyVersion: number): Buffer;
}

const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Stored layout: iv (12) | auth tag (16) | ciphertext. */
export class AesGcmSecretCipher implements SecretCipher {
  constructor(
    private readonly key: Buffer,
    readonly keyVersion: number,
  ) {
    if (key.length !== 32) {
      throw new Error('AES-256-GCM requires a 32-byte key');
    }
  }

  encrypt(plaintext: Buffer): Buffer {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
  }

  decrypt(payload: Buffer, keyVersion: number): Buffer {
    if (keyVersion !== this.keyVersion) {
      // Key rotation (RUNBOOK) re-encrypts stored values; until then old versions cannot be read.
      throw new Error(`No key loaded for key version ${keyVersion}`);
    }
    const iv = payload.subarray(0, IV_BYTES);
    const tag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(payload.subarray(IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]);
  }
}
