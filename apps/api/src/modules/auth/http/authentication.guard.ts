import { CanActivate, ExecutionContext, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode } from '@robux/shared';
import {
  AppHttpException,
  authenticationRequired,
} from '../../../common/errors/app-http.exception';
import { APP_CONFIG } from '../../../config/app-config.module';
import type { AppConfig } from '../../../config/app-config';
import { SessionLifecycleService } from '../application/session-lifecycle.service';
import { isFullyAuthenticated } from '../domain/authenticated-principal';
import { ALLOW_PENDING_TWO_FACTOR, IS_PUBLIC } from './auth-decorators';
import { type AuthenticatedRequest, readSessionToken } from './session-cookie';

/** Global guard: resolves the session cookie and enforces authentication unless @Public(). */
@Injectable()
export class AuthenticationGuard implements CanActivate {
  private readonly secureCookies: boolean;

  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionLifecycleService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.secureCookies = config.auth?.secureCookies ?? true;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = readSessionToken(req, this.secureCookies);
    req.principal = token ? ((await this.sessions.resolve(token)) ?? undefined) : undefined;

    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) {
      return true;
    }
    if (!req.principal) {
      throw authenticationRequired();
    }
    if (
      !isFullyAuthenticated(req.principal) &&
      !this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_TWO_FACTOR, targets)
    ) {
      throw new AppHttpException(
        HttpStatus.FORBIDDEN,
        ErrorCode.TWO_FACTOR_REQUIRED,
        'Verifikasi dua langkah diperlukan.',
      );
    }
    return true;
  }
}
