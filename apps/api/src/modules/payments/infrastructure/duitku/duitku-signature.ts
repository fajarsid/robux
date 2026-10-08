import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Duitku signs every operation with HMAC-SHA256 over the plain concatenation of fields, keyed with
 * the project API key, lowercase hex (docs/integrations/duitku.md §2).
 */
export function duitkuSignature(apiKey: string, ...parts: string[]): string {
  return createHmac('sha256', apiKey).update(parts.join('')).digest('hex');
}

/** Constant-time comparison of two strings, false for different lengths. */
export function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}
