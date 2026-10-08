import { Controller, Get } from '@nestjs/common';
import type { AccountProfileView } from '@robux/shared';
import type { AuthenticatedPrincipal } from '../../auth/domain/authenticated-principal';
import { Permission } from '../../auth/domain/permissions';
import { CurrentPrincipal, RequirePermissions } from '../../auth/http/auth-decorators';
import { UserDirectoryService } from '../application/user-directory.service';

@Controller('me')
export class AccountController {
  constructor(private readonly directory: UserDirectoryService) {}

  @Get()
  @RequirePermissions(Permission.ACCOUNT_SELF)
  profile(@CurrentPrincipal() principal: AuthenticatedPrincipal): Promise<AccountProfileView> {
    return this.directory.getOwnProfile(principal.userId);
  }
}
