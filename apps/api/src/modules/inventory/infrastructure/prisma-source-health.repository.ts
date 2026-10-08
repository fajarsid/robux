import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import type { SourceHealthRepository, SourceToProbe } from '../domain/source-health.repository';

@Injectable()
export class PrismaSourceHealthRepository implements SourceHealthRepository {
  constructor(private readonly prisma: PrismaService) {}

  sourcesToProbe(): Promise<SourceToProbe[]> {
    return this.prisma.fulfillmentSource.findMany({
      where: { status: 'ACTIVE', health: { in: ['UNAVAILABLE', 'UNKNOWN'] } },
      select: { id: true, provider: true },
      orderBy: { id: 'asc' },
    });
  }

  async recordProbe(sourceId: string, healthy: boolean, now: Date): Promise<void> {
    await this.prisma.fulfillmentSource.update({
      where: { id: sourceId },
      data: healthy
        ? { health: 'HEALTHY', consecutiveFailures: 0, lastHealthCheckAt: now }
        : { health: 'UNAVAILABLE', lastHealthCheckAt: now },
    });
  }
}
