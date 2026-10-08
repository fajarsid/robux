import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import type { PasswordHasher } from '../domain/ports';

/** OWASP Password Storage Cheat Sheet minimum for Argon2id: 19 MiB, 2 iterations, 1 lane. */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class Argon2PasswordHasher implements PasswordHasher {
  private dummyHash?: Promise<string>;

  hash(plaintext: string): Promise<string> {
    return argon2.hash(plaintext, ARGON2_OPTIONS);
  }

  async verify(hash: string, plaintext: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plaintext);
    } catch {
      return false;
    }
  }

  async verifyAgainstDummy(plaintext: string): Promise<void> {
    this.dummyHash ??= this.hash('timing-equaliser-not-a-real-password');
    await this.verify(await this.dummyHash, plaintext);
  }

  needsRehash(hash: string): boolean {
    return argon2.needsRehash(hash, ARGON2_OPTIONS);
  }
}
