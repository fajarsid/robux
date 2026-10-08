import { Controller, Get, HttpCode, HttpStatus, Inject, Post, Req, Res } from '@nestjs/common';
import type { SessionView } from '@robux/shared';
import type { Response } from 'express';
import { RateLimit } from '../../../common/rate-limit/rate-limit.decorator';
import { APP_CONFIG } from '../../../config/app-config.module';
import type { AppConfig } from '../../../config/app-config';
import { CsrfTokenService } from '../application/csrf-token.service';
import { SessionLifecycleService } from '../application/session-lifecycle.service';
import { Public } from '../http/auth-decorators';
import { type AuthenticatedRequest, clearSessionCookie } from '../http/session-cookie';
import { AUTH_RATE_LIMITS } from './auth-rate-limits';

@Controller('auth')
export class SessionController {
  private readonly secureCookies: boolean;

  constructor(
    private readonly sessions: SessionLifecycleService,
    private readonly csrfTokens: CsrfTokenService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.secureCookies = config.auth?.secureCookies ?? true;
  }

  @Public()
  @Get('session')
  session(@Req() req: AuthenticatedRequest): SessionView {
    const principal = req.principal;
    if (!principal) {
      return { authenticated: false };
    }
    return {
      authenticated: true,
      user: {
        id: principal.userId,
        email: principal.email,
        name: principal.name,
        role: principal.role,
      },
      twoFactor: principal.twoFactor,
      csrfToken: this.csrfTokens.issue(principal.sessionTokenHash),
      expiresAt: principal.sessionExpiresAt.toISOString(),
    };
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit(AUTH_RATE_LIMITS.logoutPerIp)
  async logout(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    if (req.principal) {
      await this.sessions.end(req.principal);
    }
    clearSessionCookie(res, this.secureCookies);
  }
}
