import type { AdminProductView } from '@robux/shared';

export interface CatalogHealth {
  total: number;
  active: number;
  inactive: number;
  /** Active products a customer cannot buy because no price is in force. */
  activeWithoutPrice: number;
}

/** Counts from the product list the API already returns; nothing is estimated. */
export function catalogHealth(products: AdminProductView[]): CatalogHealth {
  const active = products.filter((product) => product.isActive);
  return {
    total: products.length,
    active: active.length,
    inactive: products.length - active.length,
    activeWithoutPrice: active.filter((product) => !product.currentPrice).length,
  };
}
