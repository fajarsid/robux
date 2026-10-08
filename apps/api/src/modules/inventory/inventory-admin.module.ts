import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { SourceManagementService } from './application/source-management.service';
import { AdminSourcesController } from './controllers/admin-sources.controller';
import { SOURCE_MANAGEMENT_REPOSITORY } from './domain/source-management.repository';
import { PrismaSourceManagementRepository } from './infrastructure/prisma-source-management.repository';
import { AdminDigitalAccountsController } from './controllers/admin-digital-accounts.controller';
import { DigitalAccountInventoryService } from './application/digital-account-inventory.service';

/** Staff source management (API process only; the worker uses `InventoryModule`). */
@Module({
  imports: [AuditModule],
  controllers: [AdminSourcesController, AdminDigitalAccountsController],
  providers: [
    SourceManagementService,
    DigitalAccountInventoryService,
    { provide: SOURCE_MANAGEMENT_REPOSITORY, useClass: PrismaSourceManagementRepository },
  ],
})
export class InventoryAdminModule {}
