import { Inject, Injectable } from '@nestjs/common';
import { type AdminProductDetailView, type AdminProductView, ErrorCode } from '@robux/shared';
import { DomainError } from '../../../common/errors/domain-error';
import { PriceVersionService } from '../../pricing/application/price-version.service';
import { PRODUCT_REPOSITORY, type ProductRepository } from '../domain/product.repository';
import { toAdminProductView, toPriceVersionView } from './product-views';

@Injectable()
export class ProductAdminQueriesService {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
    private readonly prices: PriceVersionService,
  ) {}

  async list(includeCosts: boolean, now = new Date()): Promise<AdminProductView[]> {
    const products = await this.products.list({ activeOnly: false });
    const ids = products.map((p) => p.id);
    const [history, withOrders] = await Promise.all([
      this.prices.historyFor(ids),
      this.products.productIdsWithOrders(ids),
    ]);
    return products.map((product) => {
      const versions = history.get(product.id) ?? [];
      return toAdminProductView(
        product,
        versions,
        this.prices.activeFor(versions, now),
        withOrders.has(product.id),
        includeCosts,
        now,
      );
    });
  }

  async detail(
    productId: string,
    includeCosts: boolean,
    now = new Date(),
  ): Promise<AdminProductDetailView> {
    const product = await this.products.findById(productId);
    if (!product) {
      throw new DomainError(ErrorCode.NOT_FOUND, 'Produk tidak ditemukan.');
    }
    const [history, withOrders] = await Promise.all([
      this.prices.history(product.id),
      this.products.productIdsWithOrders([product.id]),
    ]);
    const active = this.prices.activeFor(history, now);
    return {
      ...toAdminProductView(
        product,
        history,
        active,
        withOrders.has(product.id),
        includeCosts,
        now,
      ),
      prices: history.map((price) =>
        toPriceVersionView(price, active?.id ?? null, now, includeCosts),
      ),
    };
  }
}
