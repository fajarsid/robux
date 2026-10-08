import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import type { Prisma } from '../../../generated/prisma/client';
import type { AuditEvent, AuditLogRepository } from '../domain/audit-event';

@Injectable()
export class PrismaAuditLogRepository implements AuditLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  async append(event: AuditEvent & { ipMasked?: string }): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        action: event.action,
        result: event.result,
        actorType: event.actorType,
        actorUserId: event.actorUserId,
        actorRole: event.actorRole,
        resourceType: event.resourceType,
        resourceId: event.resourceId,
        before: event.before as Prisma.InputJsonValue | undefined,
        after: event.after as Prisma.InputJsonValue | undefined,
        reason: event.reason,
        ipMasked: event.ipMasked,
        requestId: event.requestId,
      },
    });
  }
}
