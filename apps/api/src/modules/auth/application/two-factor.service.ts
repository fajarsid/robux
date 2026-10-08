import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ErrorCode, type RecoveryCodesView, type TwoFactorEnrollmentView } from '@robux/shared';
import { AppHttpException, forbidden } from '../../../common/errors/app-http.exception';
import type { RequestContext } from '../../../common/http/request-context';
import type { AuditAction, AuditResult } from '../../../generated/prisma/enums';
import { RecordAuditEventService } from '../../audit/application/record-audit-event.service';
import type { AuthenticatedPrincipal } from '../domain/authenticated-principal';
import {
  PASSWORD_HASHER,
  type PasswordHasher,
  SECRET_CIPHER,
  type SecretCipher,
  TWO_FACTOR_REPOSITORY,
  type TwoFactorRepository,
} from '../domain/ports';
import { generateRecoveryCodes, normaliseRecoveryCode } from '../domain/recovery-codes';
import { encodeBase32, generateTotpSecret, totpProvisioningUri, verifyTotp } from '../domain/totp';
import { type IssuedSession, SessionLifecycleService } from './session-lifecycle.service';

const TOTP_ISSUER = 'Top Up Robux Admin';

const invalidCode = () =>
  new AppHttpException(
    HttpStatus.UNAUTHORIZED,
    ErrorCode.INVALID_TWO_FACTOR_CODE,
    'Kode verifikasi tidak valid.',
  );

/**
 * Staff second factor: TOTP enrollment, verification and single-use recovery codes. Optional per
 * staff member; once enabled, every login needs the code. Every success rotates the session.
 */
@Injectable()
export class TwoFactorService {
  constructor(
    @Inject(TWO_FACTOR_REPOSITORY) private readonly twoFactor: TwoFactorRepository,
    @Inject(SECRET_CIPHER) private readonly cipher: SecretCipher,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    private readonly sessions: SessionLifecycleService,
    private readonly audit: RecordAuditEventService,
  ) {}

  async beginEnrollment(principal: AuthenticatedPrincipal): Promise<TwoFactorEnrollmentView> {
    this.requireState(principal, 'NOT_ENROLLED');
    const secret = generateTotpSecret();
    const saved = await this.twoFactor.savePendingSecret(
      principal.userId,
      this.cipher.encrypt(secret),
      this.cipher.keyVersion,
    );
    if (!saved) {
      throw forbidden();
    }
    return {
      secret: encodeBase32(secret),
      otpauthUri: totpProvisioningUri(secret, principal.email, TOTP_ISSUER),
    };
  }

  async completeEnrollment(
    principal: AuthenticatedPrincipal,
    code: string,
    context: RequestContext,
  ): Promise<{ session: IssuedSession } & RecoveryCodesView> {
    this.requireState(principal, 'NOT_ENROLLED');
    const record = await this.twoFactor.find(principal.userId);
    if (!record || record.enabledAt) {
      throw invalidCode();
    }
    const step = verifyTotp(
      this.cipher.decrypt(record.secretCiphertext, record.keyVersion),
      code,
      new Date(),
      null,
    );
    if (step === null) {
      await this.recordAudit(
        principal,
        context,
        'TWO_FACTOR_FAILURE',
        'FAILURE',
        'enrollment code rejected',
      );
      throw invalidCode();
    }
    const recoveryCodes = generateRecoveryCodes();
    const hashes = await Promise.all(recoveryCodes.map((c) => this.hasher.hash(c)));
    if (
      !(await this.twoFactor.enableWithRecoveryCodes(principal.userId, step, hashes, new Date()))
    ) {
      throw invalidCode();
    }
    await this.recordAudit(principal, context, 'TWO_FACTOR_ENABLED', 'SUCCESS');
    const session = await this.sessions.rotate(principal, { twoFactorVerified: true }, context);
    return { session, recoveryCodes };
  }

  async verifyCode(
    principal: AuthenticatedPrincipal,
    code: string,
    context: RequestContext,
  ): Promise<IssuedSession> {
    this.requireState(principal, 'PENDING');
    const record = await this.twoFactor.find(principal.userId);
    if (!record?.enabledAt) {
      throw invalidCode();
    }
    const secret = this.cipher.decrypt(record.secretCiphertext, record.keyVersion);
    const step = verifyTotp(secret, code, new Date(), record.lastUsedStep);
    if (step === null || !(await this.twoFactor.claimStep(principal.userId, step))) {
      await this.recordAudit(
        principal,
        context,
        'TWO_FACTOR_FAILURE',
        'FAILURE',
        'TOTP code rejected',
      );
      throw invalidCode();
    }
    await this.recordAudit(principal, context, 'LOGIN', 'SUCCESS', '2FA verified');
    return this.sessions.rotate(principal, { twoFactorVerified: true }, context);
  }

  async verifyRecoveryCode(
    principal: AuthenticatedPrincipal,
    recoveryCode: string,
    context: RequestContext,
  ): Promise<IssuedSession> {
    this.requireState(principal, 'PENDING');
    const candidate = normaliseRecoveryCode(recoveryCode);
    for (const stored of await this.twoFactor.listUnusedRecoveryCodes(principal.userId)) {
      if (await this.hasher.verify(stored.codeHash, candidate)) {
        if (!(await this.twoFactor.consumeRecoveryCode(stored.id, new Date()))) {
          break;
        }
        await this.recordAudit(principal, context, 'RECOVERY_CODE_USED', 'SUCCESS');
        return this.sessions.rotate(principal, { twoFactorVerified: true }, context);
      }
    }
    await this.recordAudit(
      principal,
      context,
      'TWO_FACTOR_FAILURE',
      'FAILURE',
      'recovery code rejected',
    );
    throw invalidCode();
  }

  private requireState(
    principal: AuthenticatedPrincipal,
    expected: 'NOT_ENROLLED' | 'PENDING',
  ): void {
    if (principal.twoFactor !== expected) {
      throw forbidden();
    }
  }

  private recordAudit(
    principal: AuthenticatedPrincipal,
    context: RequestContext,
    action: AuditAction,
    result: AuditResult,
    reason?: string,
  ): Promise<void> {
    return this.audit.record({
      action,
      result,
      actorType: 'STAFF',
      actorUserId: principal.userId,
      actorRole: principal.role,
      resourceType: 'user',
      resourceId: principal.userId,
      reason,
      ipAddress: context.ipAddress,
      requestId: context.requestId,
    });
  }
}
