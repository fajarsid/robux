import { Injectable } from '@nestjs/common';
import type { ProductLineName } from '@robux/shared';
import { PrismaService } from '../../../common/database/prisma.service';
import type { StockAvailabilityReader } from '../domain/stock-availability.reader';

@Injectable()
export class PrismaStockAvailabilityReader implements StockAvailabilityReader {
  constructor(private readonly prisma: PrismaService) {}

  async availableByLine(): Promise<ReadonlyMap<ProductLineName, bigint>> {
    const rows = await this.prisma.fulfillmentSource.groupBy({
      by: ['productLine'],
      where: { status: 'ACTIVE', health: { in: ['HEALTHY', 'DEGRADED'] } },
      _sum: { availableBalance: true },
    });
    return new Map(rows.map((row) => [row.productLine, row._sum.availableBalance ?? 0n]));
  }
}
