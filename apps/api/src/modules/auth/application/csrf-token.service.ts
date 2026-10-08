import { Inject, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { APP_CONFIG } from '../../../config/app-config.module';
import type { AppConfig } from '../../../config/app-config';

/**
 * Session-bound CSRF tokens (ADR-008): HMAC of the session token hash. Nothing is stored; a token
 * is valid exactly as long as its session.
 */
@Injectable()
export class CsrfTokenService {
  private readonly secret: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    if (!config.auth) {
      throw new Error('CsrfTokenService requires auth configuration');
    }
    this.secret = config.auth.csrfSecret;
  }

  issue(sessionTokenHash: string): string {
    return createHmac('sha256', this.secret).update(sessionTokenHash).digest('base64url');
  }

  verify(sessionTokenHash: string, candidate: string | undefined): boolean {
    if (!candidate) {
      return false;
    }
    const expected = Buffer.from(this.issue(sessionTokenHash));
    const provided = Buffer.from(candidate);
    return expected.length === provided.length && timingSafeEqual(expected, provided);
  }
}
