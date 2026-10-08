import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ErrorCode, type RegisterRequest } from '@robux/shared';
import { AppHttpException } from '../../../common/errors/app-http.exception';
import type { RequestContext } from '../../../common/http/request-context';
import {
  PASSWORD_HASHER,
  type PasswordHasher,
  USER_CREDENTIAL_REPOSITORY,
  type UserCredentialRepository,
} from '../domain/ports';
import { type IssuedSession, SessionLifecycleService } from './session-lifecycle.service';

@Injectable()
export class CustomerRegistrationService {
  constructor(
    @Inject(USER_CREDENTIAL_REPOSITORY) private readonly users: UserCredentialRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    private readonly sessions: SessionLifecycleService,
  ) {}

  /**
   * Known limitation (SECURITY.md §3): without email verification (Phase 14) a duplicate email
   * cannot be hidden completely; the response is deliberately vague and the endpoint is
   * rate-limited per IP.
   */
  async register(
    request: RegisterRequest,
    context: RequestContext,
    presentedToken: string | undefined,
  ): Promise<IssuedSession> {
    const passwordHash = await this.hasher.hash(request.password);
    const user = await this.users.createCustomer({
      email: request.email,
      name: request.name,
      passwordHash,
    });
    if (!user) {
      throw new AppHttpException(
        HttpStatus.CONFLICT,
        ErrorCode.ACCOUNT_UNAVAILABLE,
        'Akun tidak dapat dibuat dengan data ini.',
      );
    }
    return this.sessions.start(user, context, presentedToken);
  }
}
