import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { APP_CONFIG } from '../../../config/app-config.module';
import type { AppConfig } from '../../../config/app-config';
import {
  DEVELOPMENT_ACCOUNT_EMAIL_DOMAIN,
  DEVELOPMENT_ACCOUNT_PASSWORD,
} from '../domain/development-accounts';
import {
  PASSWORD_HASHER,
  type PasswordHasher,
  USER_CREDENTIAL_REPOSITORY,
  type UserCredentialRepository,
} from '../domain/ports';

/** Refuses to start a production API that contains development accounts or the development password. */
@Injectable()
export class ProductionAccountSafetyCheck implements OnApplicationBootstrap {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(USER_CREDENTIAL_REPOSITORY) private readonly users: UserCredentialRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.nodeEnv !== 'production') {
      return;
    }
    if (await this.users.existsWithEmailDomain(DEVELOPMENT_ACCOUNT_EMAIL_DOMAIN)) {
      throw new Error(
        `Unsafe credentials: development accounts (@${DEVELOPMENT_ACCOUNT_EMAIL_DOMAIN}) exist in a production database`,
      );
    }
    for (const staff of await this.users.listStaffCredentials()) {
      if (
        staff.passwordHash &&
        (await this.hasher.verify(staff.passwordHash, DEVELOPMENT_ACCOUNT_PASSWORD))
      ) {
        throw new Error(
          `Unsafe credentials: staff account ${staff.id} uses the development password`,
        );
      }
    }
  }
}
