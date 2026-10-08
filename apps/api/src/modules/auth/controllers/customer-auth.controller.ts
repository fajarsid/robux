import { Body, Controller, HttpCode, HttpStatus, Inject, Post, Req, Res } from '@nestjs/common';
import {
  type LoginRequest,
  loginRequestSchema,
  type RegisterRequest,
  registerRequestSchema,
} from '@robux/shared';
import type { Response } from 'express';
import { requestContextOf } from '../../../common/http/request-context';
import { RateLimit } from '../../../common/rate-limit/rate-limit.decorator';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe';
import { APP_CONFIG } from '../../../config/app-config.module';
import type { AppConfig } from '../../../config/app-config';
import { CustomerRegistrationService } from '../application/customer-registration.service';
import { PasswordLoginService } from '../application/password-login.service';
import { Public } from '../http/auth-decorators';
import {
  type AuthenticatedRequest,
  readSessionToken,
  setSessionCookie,
} from '../http/session-cookie';
import { AUTH_RATE_LIMITS } from './auth-rate-limits';

@Controller('auth')
export class CustomerAuthController {
  private readonly secureCookies: boolean;

  constructor(
    private readonly registration: CustomerRegistrationService,
    private readonly login: PasswordLoginService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.secureCookies = config.auth?.secureCookies ?? true;
  }

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit(AUTH_RATE_LIMITS.registerPerIp)
  async register(
    @Body(new ZodValidationPipe(registerRequestSchema)) body: RegisterRequest,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const session = await this.registration.register(
      body,
      requestContextOf(req),
      readSessionToken(req, this.secureCookies),
    );
    setSessionCookie(res, this.secureCookies, session.token, session.expiresAt);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit(AUTH_RATE_LIMITS.customerLoginPerAccount, AUTH_RATE_LIMITS.customerLoginPerIp)
  async loginCustomer(
    @Body(new ZodValidationPipe(loginRequestSchema)) body: LoginRequest,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const session = await this.login.login(
      body,
      'CUSTOMER',
      requestContextOf(req),
      readSessionToken(req, this.secureCookies),
    );
    setSessionCookie(res, this.secureCookies, session.token, session.expiresAt);
  }
}
