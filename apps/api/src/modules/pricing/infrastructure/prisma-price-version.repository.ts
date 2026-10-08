import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../../../common/database/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import type { PriceVersion } from '../domain/price-version';
import type { NewPriceVersion, PriceVersionRepository } from '../domain/price-version.repository';

type PriceRow = Prisma.ProductPriceGetPayload<object>;

function toPriceVersion(row: PriceRow): PriceVersion {
  return {
    id: row.id,
    productId: row.productId,
    version: row.version,
    sellingPrice: new Decimal(row.sellingPrice.toString()),
    costPrice: new Decimal(row.costPrice.toString()),
    starsAmount: row.starsAmount,
    currency: row.currency,
    effectiveFrom: row.effectiveFrom,
    createdAt: row.createdAt,
  };
}

@Injectable()
export class PrismaPriceVersionRepository implements PriceVersionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listForProduct(productId: string): Promise<PriceVersion[]> {
    const rows = await this.prisma.productPrice.findMany({
      where: { productId },
      orderBy: { version: 'desc' },
    });
    return rows.map(toPriceVersion);
  }

  async listForProducts(productIds: readonly string[]): Promise<Map<string, PriceVersion[]>> {
    const rows = await this.prisma.productPrice.findMany({
      where: { productId: { in: [...productIds] } },
      orderBy: { version: 'desc' },
    });
    const byProduct = new Map<string, PriceVersion[]>(productIds.map((id) => [id, []]));
    for (const row of rows) {
      byProduct.get(row.productId)?.push(toPriceVersion(row));
    }
    return byProduct;
  }

  async create(version: NewPriceVersion): Promise<PriceVersion | null> {
    try {
      const row = await this.prisma.productPrice.create({
        data: {
          productId: version.productId,
          version: version.version,
          sellingPrice: version.sellingPrice.toString(),
          costPrice: version.costPrice.toString(),
          starsAmount: version.starsAmount ?? null,
          currency: version.currency as PriceRow['currency'],
          effectiveFrom: version.effectiveFrom,
          createdById: version.createdById,
        },
      });
      return toPriceVersion(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return null;
      }
      throw error;
    }
  }
}
