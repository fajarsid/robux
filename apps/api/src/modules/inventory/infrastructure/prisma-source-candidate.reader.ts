import { Injectable } from '@nestjs/common';
import type { ProductLineName } from '@robux/shared';
import { PrismaService } from '../../../common/database/prisma.service';
import type { SourceCandidate } from '../domain/routing';
import type { SourceCandidateReader } from '../domain/source-candidate.reader';

@Injectable()
export class PrismaSourceCandidateReader implements SourceCandidateReader {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every source of the line, excluded ones included, so the routing record can say why a source was not
   * chosen. A snapshot only: the reservation re-checks balance and state in its own UPDATE.
   */
  async candidates(
    productLine: ProductLineName,
  ): Promise<Omit<SourceCandidate, 'providerConfigured'>[]> {
    const sources = await this.prisma.fulfillmentSource.findMany({
      where: { productLine },
      select: {
        id: true,
        name: true,
        provider: true,
        status: true,
        health: true,
        availableBalance: true,
        priority: true,
        costPerUnit: true,
      },
      orderBy: { id: 'asc' },
    });
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      provider: s.provider,
      status: s.status,
      health: s.health,
      available: s.availableBalance,
      priority: s.priority,
      costPerUnit: s.costPerUnit?.toString() ?? null,
    }));
  }
}
