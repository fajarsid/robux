import type { ActorType, AuditAction, AuditResult } from '../../../generated/prisma/enums';

export interface AuditEvent {
  action: AuditAction;
  result: AuditResult;
  actorType: ActorType;
  actorUserId?: string;
  actorRole?: string;
  resourceType: string;
  resourceId?: string;
  /** Changed fields only. Never secrets, password hashes, tokens or codes. */
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  reason?: string;
  ipAddress?: string;
  requestId?: string;
}

export interface AuditLogRepository {
  append(event: AuditEvent & { ipMasked?: string }): Promise<void>;
}

export const AUDIT_LOG_REPOSITORY = Symbol('AUDIT_LOG_REPOSITORY');

/** Keeps the network, drops the host part: IPv4 /24, IPv6 /48. */
export function maskIpAddress(ip: string | undefined): string | undefined {
  if (!ip) {
    return undefined;
  }
  const v4 = ip.replace(/^::ffff:/, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) {
    return v4.replace(/\.\d+$/, '.0');
  }
  const groups = ip.split(':').filter(Boolean).slice(0, 3);
  return `${groups.join(':')}::`;
}
