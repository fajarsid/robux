import { createHash, randomBytes } from 'node:crypto';

const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface OpaqueToken {
  /** Given to the holder once (cookie, link). Never stored. */
  token: string;
  /** SHA-256 hex, the only form that is stored. */
  hash: string;
}

/**
 * Random bearer tokens (sessions, guest tracking). A fast hash is sufficient: with 256 bits of
 * entropy there is nothing to brute-force, and lookups by hash must be cheap.
 */
export function generateOpaqueToken(): OpaqueToken {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  return { token, hash: hashOpaqueToken(token) };
}

export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function isWellFormedOpaqueToken(candidate: string): boolean {
  return TOKEN_PATTERN.test(candidate);
}
