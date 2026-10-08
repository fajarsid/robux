import { Body, Controller, HttpCode, HttpStatus, Inject, Post, Req, Res } from '@nestjs/common';
import {
  type LoginRequest,
  loginRequestSchema,
  type RecoveryCodesView,
  recoveryCodeRequestSchema,
  type TwoFactorEnrollmentView,
  totpCodeRequestSchema,
} from '@robux/shared';
import type { Response } from 'express';
import { requestContextOf } from '../../../common/http/request-context';
import { RateLimit } from '../../../common/rate-limit/rate-limit.decorator';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe';
import { APP_CONFIG } from '../../../config/app-config.module';
import type { AppConfig } from '../../../config/app-config';
import { PasswordLoginService } from '../application/password-login.service';
import { TwoFactorService } from '../application/two-factor.service';
import type { AuthenticatedPrincipal } from '../domain/authenticated-principal';
import { AllowPendingTwoFactor, CurrentPrincipal, Public } from '../http/auth-decorators';
import {
  type AuthenticatedRequest,
  readSessionToken,
  setSessionCookie,
} from '../http/session-cookie';
import { AUTH_RATE_LIMITS } from './auth-rate-limits';

@Controller('admin/auth')
export class StaffAuthController {
  private readonly secureCookies: boolean;

  constructor(
    private readonly login: PasswordLoginService,
    private readonly twoFactor: TwoFactorService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.secureCookies = config.auth?.secureCookies ?? true;
  }

  /**
   * Password step. Staff with 2FA enabled get a short pending session that grants nothing until
   * the TOTP step; staff without 2FA (optional) are signed in fully.
   */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit(AUTH_RATE_LIMITS.staffLoginPerAccount, AUTH_RATE_LIMITS.staffLoginPerIp)
  async loginStaff(
    @Body(new ZodValidationPipe(loginRequestSchema)) body: LoginRequest,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const session = await this.login.login(
      body,
      'STAFF',
      requestContextOf(req),
      readSessionToken(req, this.secureCookies),
    );
    setSessionCookie(res, this.secureCookies, session.token, session.expiresAt);
  }

  @AllowPendingTwoFactor()
  @Post('2fa/setup')
  @RateLimit(AUTH_RATE_LIMITS.twoFactorSetupPerUser)
  setup(@CurrentPrincipal() principal: AuthenticatedPrincipal): Promise<TwoFactorEnrollmentView> {
    return this.twoFactor.beginEnrollment(principal);
  }

  @AllowPendingTwoFactor()
  @Post('2fa/activate')
  @HttpCode(HttpStatus.OK)
  @RateLimit(AUTH_RATE_LIMITS.twoFactorPerUser, AUTH_RATE_LIMITS.twoFactorPerIp)
  async activate(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body(new ZodValidationPipe(totpCodeRequestSchema)) body: { code: string },
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RecoveryCodesView> {
    const result = await this.twoFactor.completeEnrollment(
      principal,
      body.code,
      requestContextOf(req),
    );
    setSessionCookie(res, this.secureCookies, result.session.token, result.session.expiresAt);
    return { recoveryCodes: result.recoveryCodes };
  }

  @AllowPendingTwoFactor()
  @Post('2fa/verify')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit(AUTH_RATE_LIMITS.twoFactorPerUser, AUTH_RATE_LIMITS.twoFactorPerIp)
  async verify(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body(new ZodValidationPipe(totpCodeRequestSchema)) body: { code: string },
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const session = await this.twoFactor.verifyCode(principal, body.code, requestContextOf(req));
    setSessionCookie(res, this.secureCookies, session.token, session.expiresAt);
  }

  @AllowPendingTwoFactor()
  @Post('2fa/recovery')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit(AUTH_RATE_LIMITS.twoFactorPerUser, AUTH_RATE_LIMITS.twoFactorPerIp)
  async recover(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body(new ZodValidationPipe(recoveryCodeRequestSchema)) body: { recoveryCode: string },
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const session = await this.twoFactor.verifyRecoveryCode(
      principal,
      body.recoveryCode,
      requestContextOf(req),
    );
    setSessionCookie(res, this.secureCookies, session.token, session.expiresAt);
  }
}
