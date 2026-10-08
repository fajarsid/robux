import { Inject, Injectable } from '@nestjs/common';
import {
  type CatalogProductView,
  ErrorCode,
  type PriceQuoteView,
  type ProductAvailability,
  type ProductLineName,
} from '@robux/shared';
import { DomainError } from '../../../common/errors/domain-error';
import {
  STOCK_AVAILABILITY_READER,
  type StockAvailabilityReader,
} from '../../inventory/domain/stock-availability.reader';
import { toPriceBreakdownView } from '../../pricing/application/price-breakdown.view';
import { PriceVersionService } from '../../pricing/application/price-version.service';
import { quotePrice } from '../../pricing/domain/price-quote';
import type { PriceVersion } from '../../pricing/domain/price-version';
import type { Product } from '../domain/product';
import { PRODUCT_REPOSITORY, type ProductRepository } from '../domain/product.repository';
import { toCatalogView } from './product-views';

/** A product as currently offered: the price in force and whether stock can cover it. */
export interface ProductOffer {
  product: Product;
  price: PriceVersion;
  availability: ProductAvailability;
}

/**
 * The storefront view of products (PRD §77) and the one definition of "sellable" used by both
 * the catalog and order creation.
 */
@Injectable()
export class CatalogService {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
    @Inject(STOCK_AVAILABILITY_READER) private readonly stock: StockAvailabilityReader,
    private readonly prices: PriceVersionService,
  ) {}

  async list(now = new Date()): Promise<CatalogProductView[]> {
    const products = await this.products.list({ activeOnly: true });
    const history = await this.prices.historyFor(products.map((p) => p.id));
    const available = await this.stock.availableByLine();
    return products.flatMap((product) => {
      const price = this.prices.activeFor(history.get(product.id) ?? [], now);
      return price ? [toCatalogView(product, price, this.availability(product, available))] : [];
    });
  }

  async get(slug: string, now = new Date()): Promise<CatalogProductView> {
    const offer = await this.publicOffer(await this.products.findBySlug(slug), now);
    return toCatalogView(offer.product, offer.price, offer.availability);
  }

  async quote(slug: string, quantity: number, now = new Date()): Promise<PriceQuoteView> {
    const { product, price } = await this.publicOffer(await this.products.findBySlug(slug), now);
    const quote = quotePrice({
      unitPrice: price.sellingPrice,
      currency: price.currency,
      quantity,
      minQuantity: product.minQuantity,
      maxQuantity: product.maxQuantity,
      robuxAmount: product.robuxAmount,
    });
    return {
      ...toPriceBreakdownView(quote),
      productSlug: product.slug,
      priceVersionId: price.id,
      totalRobux: quote.totalRobux,
    };
  }

  /**
   * For order creation: explicit reasons instead of a generic "not found", because the customer
   * already chose this product and needs to know why it cannot be bought now.
   */
  async offerForPurchase(productId: string, now = new Date()): Promise<ProductOffer> {
    const product = await this.products.findById(productId);
    if (!product || product.archivedAt) {
      throw new DomainError(ErrorCode.PRODUCT_NOT_FOUND, 'Produk tidak ditemukan.');
    }
    const price = product.isActive
      ? this.prices.activeFor(await this.prices.history(product.id), now)
      : null;
    if (!price) {
      throw new DomainError(ErrorCode.PRODUCT_INACTIVE, 'Produk sedang tidak dijual.');
    }
    return {
      product,
      price,
      availability: this.availability(product, await this.stock.availableByLine()),
    };
  }

  /** Inactive, archived, unknown and unpriced products are all simply "not found" to browsing customers. */
  private async publicOffer(product: Product | null, now: Date): Promise<ProductOffer> {
    const price =
      product?.isActive && !product.archivedAt
        ? this.prices.activeFor(await this.prices.history(product.id), now)
        : null;
    if (!product || !price) {
      throw new DomainError(ErrorCode.NOT_FOUND, 'Produk tidak ditemukan.');
    }
    return {
      product,
      price,
      availability: this.availability(product, await this.stock.availableByLine()),
    };
  }

  /** Only sources of the product's own line count: Stars never make Robux available. */
  private availability(
    product: Product,
    available: ReadonlyMap<ProductLineName, bigint>,
  ): ProductAvailability {
    return (available.get(product.productLine) ?? 0n) >=
      BigInt(product.robuxAmount * product.minQuantity)
      ? 'AVAILABLE'
      : 'OUT_OF_STOCK';
  }
}
