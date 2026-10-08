import type { PriceVersion } from './price-version';

export interface NewPriceVersion {
  productId: string;
  version: number;
  sellingPrice: PriceVersion['sellingPrice'];
  costPrice: PriceVersion['costPrice'];
  currency: string;
  starsAmount?: number | null;
  effectiveFrom: Date;
  createdById?: string;
}

export interface PriceVersionRepository {
  listForProduct(productId: string): Promise<PriceVersion[]>;
  listForProducts(productIds: readonly string[]): Promise<Map<string, PriceVersion[]>>;
  /** Inserts a new version; returns null if that version number already exists (concurrent change). */
  create(version: NewPriceVersion): Promise<PriceVersion | null>;
}

export const PRICE_VERSION_REPOSITORY = Symbol('PRICE_VERSION_REPOSITORY');
