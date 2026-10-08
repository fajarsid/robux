import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { LoginRequest } from '@robux/shared';
import { invalidCredentials } from '../../../common/errors/app-http.exception';
import type { RequestContext } from '../../../common/http/request-context';
import type { LoginFailureReason } from '../../../generated/prisma/enums';
import { RecordAuditEventService } from '../../audit/application/record-audit-event.service';
import { isStaffRole } from '../domain/permissions';
import {
  LOGIN_ATTEMPT_REPOSITORY,
  type LoginAttemptRepository,
  PASSWORD_HASHER,
  type PasswordHasher,
  USER_CREDENTIAL_REPOSITORY,
  type UserCredentialRepository,
} from '../domain/ports';
import { type IssuedSession, SessionLifecycleService } from './session-lifecycle.service';

/** Customers sign in on the storefront; staff only on the admin login, which requires 2FA. */
export type LoginPortal = 'CUSTOMER' | 'STAFF';

@Injectable()
export class PasswordLoginService {
  constructor(
    @Inject(USER_CREDENTIAL_REPOSITORY) private readonly users: UserCredentialRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(LOGIN_ATTEMPT_REPOSITORY) private readonly attempts: LoginAttemptRepository,
    private readonly sessions: SessionLifecycleService,
    private readonly audit: RecordAuditEventService,
  ) {}

  /**
   * Every failure produces the same error and takes comparable time, whether the email is
   * unknown, the password is wrong, the account is suspended or belongs to the other portal.
   */
  async login(
    request: LoginRequest,
    portal: LoginPortal,
    context: RequestContext,
    presentedToken: string | undefined,
  ): Promise<IssuedSession> {
    const emailHash = createHash('sha256').update(request.email).digest('hex');
    const user = await this.users.findByEmail(request.email);

    let failure: LoginFailureReason | undefined;
    if (!user?.passwordHash) {
      await this.hasher.verifyAgainstDummy(request.password);
      failure = 'INVALID_CREDENTIALS';
    } else if (!(await this.hasher.verify(user.passwordHash, request.password))) {
      failure = 'INVALID_CREDENTIALS';
    } else if (user.status !== 'ACTIVE') {
      failure = 'ACCOUNT_SUSPENDED';
    } else if (isStaffRole(user.role) !== (portal === 'STAFF')) {
      failure = 'INVALID_CREDENTIALS';
    }

    await this.attempts.record({
      emailHash,
      userId: user?.id,
      ipAddress: context.ipAddress,
      succeeded: failure === undefined,
      failureReason: failure,
    });

    if (portal === 'STAFF' && user && isStaffRole(user.role)) {
      await this.audit.record({
        action: failure ? 'LOGIN_FAILED' : 'LOGIN',
        result: failure ? 'FAILURE' : 'SUCCESS',
        actorType: 'STAFF',
        actorUserId: user.id,
        actorRole: user.role,
        resourceType: 'user',
        resourceId: user.id,
        reason: failure ?? 'password accepted, 2FA pending',
        ipAddress: context.ipAddress,
        requestId: context.requestId,
      });
    }

    if (failure || !user?.passwordHash) {
      throw invalidCredentials();
    }

    if (this.hasher.needsRehash(user.passwordHash)) {
      await this.users.updatePasswordHash(user.id, await this.hasher.hash(request.password));
    }
    await this.users.recordLogin(user.id, new Date());
    return this.sessions.start(user, context, presentedToken);
  }
}
