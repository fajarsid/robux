import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import type { SystemSettingsRepository } from '../domain/system-settings.repository';

@Injectable()
export class PrismaSystemSettingsRepository implements SystemSettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async find(key: string): Promise<unknown> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key } });
    return row?.value ?? undefined;
  }
}
