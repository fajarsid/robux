import type { LoginFailureReason, UserRole, UserStatus } from '../../../generated/prisma/enums';

export interface PasswordHasher {
  hash(plaintext: string): Promise<string>;
  verify(hash: string, plaintext: string): Promise<boolean>;
  /** Spends the same time as a real verification, so unknown accounts are not distinguishable. */
  verifyAgainstDummy(plaintext: string): Promise<void>;
  needsRehash(hash: string): boolean;
}

export type { SecretCipher } from '../../../common/security/aes-gcm-secret.cipher';

export interface CredentialRecord {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  status: UserStatus;
  passwordHash: string | null;
}

export interface UserCredentialRepository {
  findByEmail(email: string): Promise<CredentialRecord | null>;
  findById(id: string): Promise<CredentialRecord | null>;
  /** Returns null when the email is already registered. */
  createCustomer(input: {
    email: string;
    name?: string;
    passwordHash: string;
  }): Promise<CredentialRecord | null>;
  updatePasswordHash(userId: string, passwordHash: string): Promise<void>;
  recordLogin(userId: string, at: Date): Promise<void>;
  existsWithEmailDomain(domain: string): Promise<boolean>;
  listStaffCredentials(): Promise<CredentialRecord[]>;
}

export interface SessionRecord {
  id: string;
  userId: string;
  familyId: string;
  twoFactorVerified: boolean;
  idleExpiresAt: Date;
  expiresAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
}

export interface NewSession {
  userId: string;
  tokenHash: string;
  familyId: string;
  twoFactorVerified: boolean;
  idleExpiresAt: Date;
  expiresAt: Date;
  ipAddress?: string;
  userAgent?: string;
}

export interface SessionRepository {
  create(session: NewSession): Promise<SessionRecord>;
  findByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  hasActiveSessionInFamily(familyId: string, now: Date): Promise<boolean>;
  touch(sessionId: string, now: Date, idleExpiresAt: Date): Promise<void>;
  /** Revokes only if still active; returns whether this call revoked it. */
  revoke(sessionId: string, now: Date): Promise<boolean>;
  revokeFamily(familyId: string, now: Date): Promise<void>;
  revokeAllForUser(userId: string, now: Date, exceptSessionId?: string): Promise<void>;
}

export interface LoginAttemptRepository {
  record(attempt: {
    emailHash: string;
    userId?: string;
    ipAddress: string;
    succeeded: boolean;
    failureReason?: LoginFailureReason;
  }): Promise<void>;
}

export interface TwoFactorRecord {
  userId: string;
  secretCiphertext: Buffer;
  keyVersion: number;
  enabledAt: Date | null;
  lastUsedStep: number | null;
}

export interface TwoFactorRepository {
  find(userId: string): Promise<TwoFactorRecord | null>;
  /** Replaces any unconfirmed secret; refuses to overwrite an enabled one. */
  savePendingSecret(userId: string, secretCiphertext: Buffer, keyVersion: number): Promise<boolean>;
  /**
   * Records `step` as used only if it is newer than the stored one (compare-and-set), so two
   * concurrent requests with the same code cannot both succeed.
   */
  claimStep(userId: string, step: number): Promise<boolean>;
  enableWithRecoveryCodes(
    userId: string,
    step: number,
    codeHashes: string[],
    now: Date,
  ): Promise<boolean>;
  listUnusedRecoveryCodes(userId: string): Promise<{ id: string; codeHash: string }[]>;
  /** Marks a code used only if still unused; returns whether this call consumed it. */
  consumeRecoveryCode(codeId: string, now: Date): Promise<boolean>;
}

export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');
export const SECRET_CIPHER = Symbol('SECRET_CIPHER');
export const USER_CREDENTIAL_REPOSITORY = Symbol('USER_CREDENTIAL_REPOSITORY');
export const SESSION_REPOSITORY = Symbol('SESSION_REPOSITORY');
export const LOGIN_ATTEMPT_REPOSITORY = Symbol('LOGIN_ATTEMPT_REPOSITORY');
export const TWO_FACTOR_REPOSITORY = Symbol('TWO_FACTOR_REPOSITORY');
