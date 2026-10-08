import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode } from '@robux/shared';
import { AppHttpException } from '../../../common/errors/app-http.exception';
import { APP_CONFIG } from '../../../config/app-config.module';
import type { AppConfig } from '../../../config/app-config';
import { CsrfTokenService } from '../application/csrf-token.service';
import { SKIP_CSRF } from './auth-decorators';
import type { AuthenticatedRequest } from './session-cookie';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
export const CSRF_HEADER = 'x-csrf-token';

const csrfRejected = () =>
  new AppHttpException(HttpStatus.FORBIDDEN, ErrorCode.CSRF_REJECTED, 'Permintaan ditolak.');

/**
 * ADR-008: state-changing requests need a trusted Origin (or Referer), and, when a session is
 * present, a CSRF token bound to that session. SameSite=Lax is defence in depth only.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly logger = new Logger(CsrfGuard.name);
  private readonly trustedOrigins: ReadonlySet<string>;

  constructor(
    private readonly reflector: Reflector,
    private readonly csrfTokens: CsrfTokenService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.trustedOrigins = new Set(config.auth?.trustedOrigins ?? []);
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (SAFE_METHODS.has(req.method)) {
      return true;
    }
    if (
      this.reflector.getAllAndOverride<boolean>(SKIP_CSRF, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }
    const origin = this.requestOrigin(req);
    if (!origin || !this.trustedOrigins.has(origin)) {
      this.logger.warn({ event: 'csrf.origin_rejected', origin: origin ?? null });
      throw csrfRejected();
    }
    if (req.principal) {
      const header = req.headers[CSRF_HEADER];
      const token = Array.isArray(header) ? header[0] : header;
      if (!this.csrfTokens.verify(req.principal.sessionTokenHash, token)) {
        this.logger.warn({ event: 'csrf.token_rejected' });
        throw csrfRejected();
      }
    }
    return true;
  }

  private requestOrigin(req: AuthenticatedRequest): string | undefined {
    const origin = req.headers.origin;
    if (origin && origin !== 'null') {
      return origin;
    }
    const referer = req.headers.referer;
    if (!referer) {
      return undefined;
    }
    try {
      return new URL(referer).origin;
    } catch {
      return undefined;
    }
  }
}
