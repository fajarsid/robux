import { Module } from '@nestjs/common';
import { SystemSettingsService } from './application/system-settings.service';
import { SYSTEM_SETTINGS_REPOSITORY } from './domain/system-settings.repository';
import { PrismaSystemSettingsRepository } from './infrastructure/prisma-system-settings.repository';

@Module({
  providers: [
    SystemSettingsService,
    { provide: SYSTEM_SETTINGS_REPOSITORY, useClass: PrismaSystemSettingsRepository },
  ],
  exports: [SystemSettingsService],
})
export class SettingsModule {}
