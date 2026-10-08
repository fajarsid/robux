import { Body, Controller, HttpCode, HttpStatus, Inject, Post, Req, Res } from '@nestjs/common';
import { type ChangePasswordRequest, changePasswordRequestSchema } from '@robux/shared';
import type { Response } from 'express';
import { requestContextOf } from '../../../common/http/request-context';
import { RateLimit } from '../../../common/rate-limit/rate-limit.decorator';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe';
import { APP_CONFIG } from '../../../config/app-config.module';
import type { AppConfig } from '../../../config/app-config';
import { ChangePasswordService } from '../application/change-password.service';
import type { AuthenticatedPrincipal } from '../domain/authenticated-principal';
import { Permission } from '../domain/permissions';
import { CurrentPrincipal, RequirePermissions } from '../http/auth-decorators';
import { type AuthenticatedRequest, setSessionCookie } from '../http/session-cookie';
import { AUTH_RATE_LIMITS } from './auth-rate-limits';

@Controller('me')
export class PasswordController {
  private readonly secureCookies: boolean;

  constructor(
    private readonly changePassword: ChangePasswordService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.secureCookies = config.auth?.secureCookies ?? true;
  }

  @Post('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(Permission.ACCOUNT_SELF)
  @RateLimit(AUTH_RATE_LIMITS.passwordChangePerUser)
  async change(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body(new ZodValidationPipe(changePasswordRequestSchema)) body: ChangePasswordRequest,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const session = await this.changePassword.change(principal, body, requestContextOf(req));
    setSessionCookie(res, this.secureCookies, session.token, session.expiresAt);
  }
}
