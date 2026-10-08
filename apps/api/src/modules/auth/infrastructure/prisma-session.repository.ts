import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import type { NewSession, SessionRecord, SessionRepository } from '../domain/ports';

const SESSION_FIELDS = {
  id: true,
  userId: true,
  familyId: true,
  twoFactorVerified: true,
  idleExpiresAt: true,
  expiresAt: true,
  lastSeenAt: true,
  revokedAt: true,
} as const;

@Injectable()
export class PrismaSessionRepository implements SessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(session: NewSession): Promise<SessionRecord> {
    return this.prisma.userSession.create({ data: session, select: SESSION_FIELDS });
  }

  findByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    return this.prisma.userSession.findUnique({ where: { tokenHash }, select: SESSION_FIELDS });
  }

  async hasActiveSessionInFamily(familyId: string, now: Date): Promise<boolean> {
    const count = await this.prisma.userSession.count({
      where: { familyId, revokedAt: null, expiresAt: { gt: now }, idleExpiresAt: { gt: now } },
    });
    return count > 0;
  }

  async touch(sessionId: string, now: Date, idleExpiresAt: Date): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { lastSeenAt: now, idleExpiresAt },
    });
  }

  async revoke(sessionId: string, now: Date): Promise<boolean> {
    const { count } = await this.prisma.userSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: now },
    });
    return count === 1;
  }

  async revokeFamily(familyId: string, now: Date): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: now },
    });
  }

  async revokeAllForUser(userId: string, now: Date, exceptSessionId?: string): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      data: { revokedAt: now },
    });
  }
}
