import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import type { Product, ProductChanges } from '../domain/product';
import type { InitialPrice, NewProduct, ProductRepository } from '../domain/product.repository';

const PRODUCT_SELECT = {
  id: true,
  slug: true,
  name: true,
  robuxAmount: true,
  fulfillmentMethod: true,
  productLine: true,
  minQuantity: true,
  maxQuantity: true,
  displayOrder: true,
  isActive: true,
  archivedAt: true,
  updatedAt: true,
} as const satisfies Prisma.ProductSelect;

@Injectable()
export class PrismaProductRepository implements ProductRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<Product | null> {
    return this.prisma.product.findUnique({ where: { id }, select: PRODUCT_SELECT });
  }

  findBySlug(slug: string): Promise<Product | null> {
    return this.prisma.product.findUnique({ where: { slug }, select: PRODUCT_SELECT });
  }

  list(options: { activeOnly: boolean }): Promise<Product[]> {
    return this.prisma.product.findMany({
      where: { archivedAt: null, ...(options.activeOnly ? { isActive: true } : {}) },
      select: PRODUCT_SELECT,
      orderBy: [{ displayOrder: 'asc' }, { robuxAmount: 'asc' }],
    });
  }

  async createWithInitialPrice(product: NewProduct, price: InitialPrice): Promise<Product | null> {
    try {
      return await this.prisma.product.create({
        data: {
          ...product,
          isActive: false,
          prices: {
            create: {
              version: 1,
              sellingPrice: price.sellingPrice.toString(),
              costPrice: price.costPrice.toString(),
              starsAmount: price.starsAmount ?? null,
              currency: price.currency as 'IDR',
              effectiveFrom: price.effectiveFrom,
              createdById: price.createdById,
            },
          },
        },
        select: PRODUCT_SELECT,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return null;
      }
      throw error;
    }
  }

  update(id: string, changes: ProductChanges): Promise<Product> {
    return this.prisma.product.update({ where: { id }, data: changes, select: PRODUCT_SELECT });
  }

  async setActive(id: string, active: boolean): Promise<boolean> {
    const { count } = await this.prisma.product.updateMany({
      where: { id, isActive: !active, archivedAt: null },
      data: { isActive: active },
    });
    return count === 1;
  }

  async productIdsWithOrders(productIds: readonly string[]): Promise<Set<string>> {
    const rows = await this.prisma.orderItem.findMany({
      where: { productId: { in: [...productIds] } },
      select: { productId: true },
      distinct: ['productId'],
    });
    return new Set(rows.map((row) => row.productId));
  }
}
