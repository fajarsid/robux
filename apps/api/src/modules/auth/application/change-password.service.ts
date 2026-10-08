import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { type ChangePasswordRequest, ErrorCode } from '@robux/shared';
import { AppHttpException } from '../../../common/errors/app-http.exception';
import type { RequestContext } from '../../../common/http/request-context';
import type { AuthenticatedPrincipal } from '../domain/authenticated-principal';
import {
  PASSWORD_HASHER,
  type PasswordHasher,
  USER_CREDENTIAL_REPOSITORY,
  type UserCredentialRepository,
} from '../domain/ports';
import { type IssuedSession, SessionLifecycleService } from './session-lifecycle.service';

@Injectable()
export class ChangePasswordService {
  constructor(
    @Inject(USER_CREDENTIAL_REPOSITORY) private readonly users: UserCredentialRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    private readonly sessions: SessionLifecycleService,
  ) {}

  /** Signs out every other session of the user and rotates the current one. */
  async change(
    principal: AuthenticatedPrincipal,
    request: ChangePasswordRequest,
    context: RequestContext,
  ): Promise<IssuedSession> {
    const user = await this.users.findById(principal.userId);
    if (
      !user?.passwordHash ||
      !(await this.hasher.verify(user.passwordHash, request.currentPassword))
    ) {
      throw new AppHttpException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.INVALID_CREDENTIALS,
        'Kata sandi saat ini salah.',
      );
    }
    await this.users.updatePasswordHash(user.id, await this.hasher.hash(request.newPassword));
    await this.sessions.revokeOtherSessions(user.id, principal.sessionId);
    return this.sessions.rotate(
      principal,
      { twoFactorVerified: principal.twoFactor === 'VERIFIED' },
      context,
    );
  }
}
