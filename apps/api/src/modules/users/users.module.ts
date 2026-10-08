import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { ChangeStaffRoleService } from './application/change-staff-role.service';
import { UserDirectoryService } from './application/user-directory.service';
import { AccountController } from './controllers/account.controller';
import { StaffController } from './controllers/staff.controller';
import { USER_DIRECTORY_REPOSITORY } from './domain/user-directory.repository';
import { PrismaUserDirectoryRepository } from './infrastructure/prisma-user-directory.repository';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [AccountController, StaffController],
  providers: [
    UserDirectoryService,
    ChangeStaffRoleService,
    { provide: USER_DIRECTORY_REPOSITORY, useClass: PrismaUserDirectoryRepository },
  ],
})
export class UsersModule {}
