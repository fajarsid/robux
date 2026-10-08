import type Decimal from 'decimal.js';
import type { Product, ProductChanges } from './product';

export interface NewProduct {
  slug: string;
  name: string;
  robuxAmount: number;
  fulfillmentMethod: Product['fulfillmentMethod'];
  productLine: Product['productLine'];
  minQuantity: number;
  maxQuantity: number;
  displayOrder: number;
}

export interface InitialPrice {
  sellingPrice: Decimal;
  costPrice: Decimal;
  currency: string;
  starsAmount?: number | null;
  effectiveFrom: Date;
  createdById?: string;
}

export interface ProductRepository {
  findById(id: string): Promise<Product | null>;
  findBySlug(slug: string): Promise<Product | null>;
  /** Not archived, ordered for display; `activeOnly` for the storefront. */
  list(options: { activeOnly: boolean }): Promise<Product[]>;
  /**
   * Creates the product (inactive) together with price version 1 in one transaction, so a product
   * never exists without a price. Returns null if the slug is taken.
   */
  createWithInitialPrice(product: NewProduct, price: InitialPrice): Promise<Product | null>;
  update(id: string, changes: ProductChanges): Promise<Product>;
  /** Flips the flag only if it differs; returns whether this call changed it. */
  setActive(id: string, active: boolean): Promise<boolean>;
  productIdsWithOrders(productIds: readonly string[]): Promise<Set<string>>;
}

export const PRODUCT_REPOSITORY = Symbol('PRODUCT_REPOSITORY');
