import type {
  AdminPriceVersionView,
  AdminProductView,
  CatalogProductView,
  ProductAvailability,
} from '@robux/shared';
import { formatMoneyAmount } from '../../pricing/domain/money';
import {
  marginOf,
  type PriceVersion,
  priceVersionStatus,
} from '../../pricing/domain/price-version';
import type { Product } from '../domain/product';
import { productFulfillmentOf } from '../domain/product-line';

/** Cost and margin are business-sensitive: only callers with pricing.write see them. */
export function toPriceVersionView(
  price: PriceVersion,
  activeId: string | null,
  now: Date,
  includeCosts: boolean,
): AdminPriceVersionView {
  return {
    id: price.id,
    version: price.version,
    status: priceVersionStatus(price, activeId, now),
    sellingPrice: formatMoneyAmount(price.sellingPrice),
    starsAmount: price.starsAmount ?? null,
    currency: price.currency,
    effectiveFrom: price.effectiveFrom.toISOString(),
    createdAt: price.createdAt.toISOString(),
    ...(includeCosts
      ? {
          costPrice: formatMoneyAmount(price.costPrice),
          margin: formatMoneyAmount(marginOf(price)),
        }
      : {}),
  };
}

export function toAdminProductView(
  product: Product,
  history: readonly PriceVersion[],
  activePrice: PriceVersion | null,
  hasOrders: boolean,
  includeCosts: boolean,
  now: Date,
): AdminProductView {
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    robuxAmount: product.robuxAmount,
    fulfillmentMethod: product.fulfillmentMethod,
    ...productFulfillmentOf(product.productLine),
    minQuantity: product.minQuantity,
    maxQuantity: product.maxQuantity,
    displayOrder: product.displayOrder,
    isActive: product.isActive,
    hasOrders,
    currentPrice: activePrice
      ? toPriceVersionView(activePrice, activePrice.id, now, includeCosts)
      : null,
    latestVersion: history.reduce((max, price) => Math.max(max, price.version), 0),
    updatedAt: product.updatedAt.toISOString(),
  };
}

export function toCatalogView(
  product: Product,
  activePrice: PriceVersion,
  availability: ProductAvailability,
): CatalogProductView {
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    robuxAmount: product.robuxAmount,
    fulfillmentMethod: product.fulfillmentMethod,
    ...productFulfillmentOf(product.productLine),
    minQuantity: product.minQuantity,
    maxQuantity: product.maxQuantity,
    price: {
      amount: formatMoneyAmount(activePrice.sellingPrice),
      currency: activePrice.currency,
      versionId: activePrice.id,
      starsAmount: activePrice.starsAmount ?? null,
    },
    availability,
  };
}
