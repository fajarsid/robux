import { Inject, Injectable } from '@nestjs/common';
import {
  AUDIT_LOG_REPOSITORY,
  type AuditEvent,
  type AuditLogRepository,
  maskIpAddress,
} from '../domain/audit-event';

@Injectable()
export class RecordAuditEventService {
  constructor(@Inject(AUDIT_LOG_REPOSITORY) private readonly repository: AuditLogRepository) {}

  /** Throws on failure: an administrative action must not succeed without its audit record. */
  record(event: AuditEvent): Promise<void> {
    const { ipAddress, ...rest } = event;
    return this.repository.append({ ...rest, ipMasked: maskIpAddress(ipAddress) });
  }
}
