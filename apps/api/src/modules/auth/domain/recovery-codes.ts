import { randomInt } from 'node:crypto';

export const RECOVERY_CODE_COUNT = 10;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const GROUP_LENGTH = 5;

/** `XXXXX-XXXXX` from a 32-symbol alphabet: 50 bits each, unambiguous to type. */
export function generateRecoveryCode(): string {
  const group = () =>
    Array.from({ length: GROUP_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return `${group()}-${group()}`;
}

export function generateRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
}

export function normaliseRecoveryCode(input: string): string {
  return input.trim().toUpperCase();
}
