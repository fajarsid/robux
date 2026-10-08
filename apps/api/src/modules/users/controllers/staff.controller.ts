import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Req } from '@nestjs/common';
import {
  type AccountProfileView,
  type ChangeStaffRoleRequest,
  changeStaffRoleRequestSchema,
  type StaffMemberView,
} from '@robux/shared';
import type { Request } from 'express';
import { requestContextOf } from '../../../common/http/request-context';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe';
import type { AuthenticatedPrincipal } from '../../auth/domain/authenticated-principal';
import { Permission } from '../../auth/domain/permissions';
import { CurrentPrincipal, RequirePermissions } from '../../auth/http/auth-decorators';
import { ChangeStaffRoleService } from '../application/change-staff-role.service';
import { UserDirectoryService } from '../application/user-directory.service';

@Controller('admin')
export class StaffController {
  constructor(
    private readonly directory: UserDirectoryService,
    private readonly changeRole: ChangeStaffRoleService,
  ) {}

  @Get('me')
  @RequirePermissions(Permission.STAFF_CONSOLE)
  me(@CurrentPrincipal() principal: AuthenticatedPrincipal): Promise<AccountProfileView> {
    return this.directory.getOwnProfile(principal.userId);
  }

  @Get('staff')
  @RequirePermissions(Permission.STAFF_MANAGE)
  list(): Promise<StaffMemberView[]> {
    return this.directory.listStaff();
  }

  @Patch('staff/:id/role')
  @RequirePermissions(Permission.STAFF_MANAGE)
  updateRole(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) targetUserId: string,
    @Body(new ZodValidationPipe(changeStaffRoleRequestSchema)) body: ChangeStaffRoleRequest,
    @Req() req: Request,
  ): Promise<StaffMemberView> {
    return this.changeRole.change(principal, targetUserId, body, requestContextOf(req));
  }
}
