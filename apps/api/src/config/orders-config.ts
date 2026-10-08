import { readSecret } from './read-secret';

export interface OrdersConfig {
  /**
   * AES-256-GCM key for values kept only to replay an idempotent order response (the guest
   * tracking token), so the plaintext token is never stored.
   */
  idempotencyEncryptionKey: Buffer;
  idempotencyEncryptionKeyVersion: number;
}

export function loadOrdersConfig(env: NodeJS.ProcessEnv): OrdersConfig {
  const keyHex = readSecret(env, 'IDEMPOTENCY_ENCRYPTION_KEY');
  if (!keyHex || !/^[0-9a-f]{64}$/i.test(keyHex)) {
    throw new Error(
      'Invalid configuration: IDEMPOTENCY_ENCRYPTION_KEY(_FILE) must be 64 hex characters',
    );
  }
  return {
    idempotencyEncryptionKey: Buffer.from(keyHex, 'hex'),
    idempotencyEncryptionKeyVersion: Number(env.IDEMPOTENCY_ENCRYPTION_KEY_VERSION ?? '1'),
  };
}
