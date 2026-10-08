import { Module } from '@nestjs/common';
import { RecordAuditEventService } from './application/record-audit-event.service';
import { AUDIT_LOG_REPOSITORY } from './domain/audit-event';
import { PrismaAuditLogRepository } from './infrastructure/prisma-audit-log.repository';

@Module({
  providers: [
    RecordAuditEventService,
    { provide: AUDIT_LOG_REPOSITORY, useClass: PrismaAuditLogRepository },
  ],
  exports: [RecordAuditEventService],
})
export class AuditModule {}
