import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { TwoFactorState } from '@robux/shared';
import { generateOpaqueToken, hashOpaqueToken } from '../../../common/security/opaque-token';
import type { RequestContext } from '../../../common/http/request-context';
import type { AuthenticatedPrincipal } from '../domain/authenticated-principal';
import { isStaffRole } from '../domain/permissions';
import {
  type CredentialRecord,
  SESSION_REPOSITORY,
  type SessionRecord,
  type SessionRepository,
  TWO_FACTOR_REPOSITORY,
  type TwoFactorRepository,
  USER_CREDENTIAL_REPOSITORY,
  type UserCredentialRepository,
} from '../domain/ports';
import {
  extendedIdleExpiry,
  SESSION_TOUCH_INTERVAL_MS,
  type SessionKind,
  sessionExpiry,
} from '../domain/session-policy';

export interface IssuedSession {
  token: string;
  expiresAt: Date;
}

@Injectable()
export class SessionLifecycleService {
  constructor(
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    @Inject(USER_CREDENTIAL_REPOSITORY) private readonly users: UserCredentialRepository,
    @Inject(TWO_FACTOR_REPOSITORY) private readonly twoFactor: TwoFactorRepository,
  ) {}

  /**
   * Starts a brand-new session. Any session the browser presented beforehand is revoked, so a
   * session id planted before login can never become authenticated (fixation).
   */
  async start(
    user: CredentialRecord,
    context: RequestContext,
    presentedToken: string | undefined,
    now = new Date(),
  ): Promise<IssuedSession> {
    if (presentedToken) {
      const previous = await this.sessions.findByTokenHash(hashOpaqueToken(presentedToken));
      if (previous) {
        await this.sessions.revokeFamily(previous.familyId, now);
      }
    }
    const kind = await this.sessionKind(user.id, user.role, false);
    return this.issue(user.id, randomUUID(), kind, false, context, now);
  }

  /** Replaces the current session with a new token in the same family (2FA, password change). */
  async rotate(
    principal: AuthenticatedPrincipal,
    options: { twoFactorVerified: boolean },
    context: RequestContext,
    now = new Date(),
  ): Promise<IssuedSession> {
    const current = await this.sessions.findByTokenHash(principal.sessionTokenHash);
    const familyId = current?.familyId ?? randomUUID();
    await this.sessions.revoke(principal.sessionId, now);
    const kind = await this.sessionKind(
      principal.userId,
      principal.role,
      options.twoFactorVerified,
    );
    return this.issue(principal.userId, familyId, kind, options.twoFactorVerified, context, now);
  }

  async end(principal: AuthenticatedPrincipal, now = new Date()): Promise<void> {
    const current = await this.sessions.findByTokenHash(principal.sessionTokenHash);
    if (current) {
      await this.sessions.revokeFamily(current.familyId, now);
    }
  }

  revokeOtherSessions(
    userId: string,
    keepSessionId: string | undefined,
    now = new Date(),
  ): Promise<void> {
    return this.sessions.revokeAllForUser(userId, now, keepSessionId);
  }

  /** Resolves a cookie token to a principal, or null if missing, expired, revoked or the user is suspended. */
  async resolve(token: string, now = new Date()): Promise<AuthenticatedPrincipal | null> {
    const tokenHash = hashOpaqueToken(token);
    const session = await this.sessions.findByTokenHash(tokenHash);
    if (!session) {
      return null;
    }
    if (session.revokedAt) {
      // A rotated-away token coming back while its successor is alive suggests it was stolen.
      if (await this.sessions.hasActiveSessionInFamily(session.familyId, now)) {
        await this.sessions.revokeFamily(session.familyId, now);
      }
      return null;
    }
    if (session.expiresAt <= now || session.idleExpiresAt <= now) {
      return null;
    }
    const user = await this.users.findById(session.userId);
    if (!user || user.status !== 'ACTIVE') {
      await this.sessions.revoke(session.id, now);
      return null;
    }
    const twoFactor = await this.twoFactorState(user, session);
    await this.touchIfDue(session, user, twoFactor, now);
    return {
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      sessionId: session.id,
      sessionTokenHash: tokenHash,
      sessionExpiresAt: session.expiresAt,
      twoFactor,
    };
  }

  private async issue(
    userId: string,
    familyId: string,
    kind: SessionKind,
    twoFactorVerified: boolean,
    context: RequestContext,
    now: Date,
  ): Promise<IssuedSession> {
    const { token, hash } = generateOpaqueToken();
    const expiry = sessionExpiry(kind, now);
    await this.sessions.create({
      userId,
      tokenHash: hash,
      familyId,
      twoFactorVerified,
      ...expiry,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
    return { token, expiresAt: expiry.expiresAt };
  }

  private async twoFactorState(
    user: CredentialRecord,
    session: SessionRecord,
  ): Promise<TwoFactorState> {
    if (!isStaffRole(user.role)) {
      return 'NOT_REQUIRED';
    }
    if (session.twoFactorVerified) {
      return 'VERIFIED';
    }
    return (await this.hasEnabledTwoFactor(user.id)) ? 'PENDING' : 'NOT_ENROLLED';
  }

  /** A staff session is short-lived only while an enabled second factor is still unverified. */
  private async sessionKind(
    userId: string,
    role: CredentialRecord['role'],
    twoFactorVerified: boolean,
  ): Promise<SessionKind> {
    if (!isStaffRole(role)) {
      return 'CUSTOMER';
    }
    if (twoFactorVerified || !(await this.hasEnabledTwoFactor(userId))) {
      return 'STAFF';
    }
    return 'STAFF_PENDING_TWO_FACTOR';
  }

  private async hasEnabledTwoFactor(userId: string): Promise<boolean> {
    return Boolean((await this.twoFactor.find(userId))?.enabledAt);
  }

  private async touchIfDue(
    session: SessionRecord,
    user: CredentialRecord,
    twoFactor: TwoFactorState,
    now: Date,
  ): Promise<void> {
    if (now.getTime() - session.lastSeenAt.getTime() < SESSION_TOUCH_INTERVAL_MS) {
      return;
    }
    const kind: SessionKind = !isStaffRole(user.role)
      ? 'CUSTOMER'
      : twoFactor === 'PENDING'
        ? 'STAFF_PENDING_TWO_FACTOR'
        : 'STAFF';
    await this.sessions.touch(session.id, now, extendedIdleExpiry(kind, now, session.expiresAt));
  }
}
