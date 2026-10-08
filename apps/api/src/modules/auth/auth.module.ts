import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { RateLimitGuard } from '../../common/rate-limit/rate-limit.guard';
import { RateLimitModule } from '../../common/rate-limit/rate-limit.module';
import { APP_CONFIG } from '../../config/app-config.module';
import type { AppConfig } from '../../config/app-config';
import { AuditModule } from '../audit/audit.module';
import { ChangePasswordService } from './application/change-password.service';
import { CsrfTokenService } from './application/csrf-token.service';
import { CustomerRegistrationService } from './application/customer-registration.service';
import { PasswordLoginService } from './application/password-login.service';
import { ProductionAccountSafetyCheck } from './application/production-account-safety.check';
import { SessionLifecycleService } from './application/session-lifecycle.service';
import { TwoFactorService } from './application/two-factor.service';
import { CustomerAuthController } from './controllers/customer-auth.controller';
import { PasswordController } from './controllers/password.controller';
import { SessionController } from './controllers/session.controller';
import { StaffAuthController } from './controllers/staff-auth.controller';
import {
  LOGIN_ATTEMPT_REPOSITORY,
  PASSWORD_HASHER,
  SECRET_CIPHER,
  SESSION_REPOSITORY,
  TWO_FACTOR_REPOSITORY,
  USER_CREDENTIAL_REPOSITORY,
} from './domain/ports';
import { AuthenticationGuard } from './http/authentication.guard';
import { CsrfGuard } from './http/csrf.guard';
import { PermissionGuard } from './http/permission.guard';
import { AesGcmSecretCipher } from '../../common/security/aes-gcm-secret.cipher';
import { Argon2PasswordHasher } from './infrastructure/argon2-password.hasher';
import { PrismaLoginAttemptRepository } from './infrastructure/prisma-login-attempt.repository';
import { PrismaSessionRepository } from './infrastructure/prisma-session.repository';
import { PrismaTwoFactorRepository } from './infrastructure/prisma-two-factor.repository';
import { PrismaUserCredentialRepository } from './infrastructure/prisma-user-credential.repository';

@Module({
  imports: [AuditModule, RateLimitModule],
  controllers: [SessionController, CustomerAuthController, StaffAuthController, PasswordController],
  providers: [
    SessionLifecycleService,
    CsrfTokenService,
    PasswordLoginService,
    CustomerRegistrationService,
    TwoFactorService,
    ChangePasswordService,
    ProductionAccountSafetyCheck,
    { provide: PASSWORD_HASHER, useClass: Argon2PasswordHasher },
    {
      provide: SECRET_CIPHER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => {
        if (!config.auth) {
          throw new Error('Auth configuration is required for the API');
        }
        return new AesGcmSecretCipher(
          config.auth.totpEncryptionKey,
          config.auth.totpEncryptionKeyVersion,
        );
      },
    },
    { provide: USER_CREDENTIAL_REPOSITORY, useClass: PrismaUserCredentialRepository },
    { provide: SESSION_REPOSITORY, useClass: PrismaSessionRepository },
    { provide: LOGIN_ATTEMPT_REPOSITORY, useClass: PrismaLoginAttemptRepository },
    { provide: TWO_FACTOR_REPOSITORY, useClass: PrismaTwoFactorRepository },
    // Order matters: identify the caller, then rate-limit, then CSRF, then authorise.
    { provide: APP_GUARD, useClass: AuthenticationGuard },
    { provide: APP_GUARD, useExisting: RateLimitGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
  exports: [PASSWORD_HASHER, SessionLifecycleService],
})
export class AuthModule {}
