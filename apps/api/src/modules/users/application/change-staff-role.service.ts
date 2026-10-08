import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { type ChangeStaffRoleRequest, ErrorCode, type StaffMemberView } from '@robux/shared';
import { AppHttpException, notFound } from '../../../common/errors/app-http.exception';
import type { RequestContext } from '../../../common/http/request-context';
import { RecordAuditEventService } from '../../audit/application/record-audit-event.service';
import { SessionLifecycleService } from '../../auth/application/session-lifecycle.service';
import type { AuthenticatedPrincipal } from '../../auth/domain/authenticated-principal';
import { isStaffRole } from '../../auth/domain/permissions';
import {
  USER_DIRECTORY_REPOSITORY,
  type UserDirectoryRepository,
} from '../domain/user-directory.repository';
import { toStaffMemberView } from './user-directory.service';

const conflict = (message: string) =>
  new AppHttpException(HttpStatus.CONFLICT, ErrorCode.VALIDATION_FAILED, message);

@Injectable()
export class ChangeStaffRoleService {
  constructor(
    @Inject(USER_DIRECTORY_REPOSITORY) private readonly users: UserDirectoryRepository,
    private readonly sessions: SessionLifecycleService,
    private readonly audit: RecordAuditEventService,
  ) {}

  /**
   * Staff roles only (customers are never promoted here), never one's own role, and the target
   * must sign in again so the new permissions take effect immediately.
   */
  async change(
    actor: AuthenticatedPrincipal,
    targetUserId: string,
    request: ChangeStaffRoleRequest,
    context: RequestContext,
  ): Promise<StaffMemberView> {
    if (actor.userId === targetUserId) {
      throw conflict('Peran akun sendiri tidak dapat diubah.');
    }
    const target = await this.users.findProfile(targetUserId);
    if (!target || !isStaffRole(target.role)) {
      throw notFound();
    }
    if (!(await this.users.changeRole(target.id, target.role, request.role))) {
      throw conflict('Data berubah. Muat ulang dan coba lagi.');
    }
    await this.sessions.revokeOtherSessions(target.id, undefined);
    await this.audit.record({
      action: 'STAFF_ACCOUNT_CHANGED',
      result: 'SUCCESS',
      actorType: 'STAFF',
      actorUserId: actor.userId,
      actorRole: actor.role,
      resourceType: 'user',
      resourceId: target.id,
      before: { role: target.role },
      after: { role: request.role },
      ipAddress: context.ipAddress,
      requestId: context.requestId,
    });
    return toStaffMemberView({ ...target, role: request.role });
  }
}
