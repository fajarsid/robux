import {
  ErrorCode,
  type FulfillmentMethodName,
  PRODUCT_QUANTITY_CEILING,
  type ProductLineName,
} from '@robux/shared';
import { DomainError } from '../../../common/errors/domain-error';

export interface Product {
  id: string;
  slug: string;
  name: string;
  robuxAmount: number;
  fulfillmentMethod: FulfillmentMethodName;
  productLine: ProductLineName;
  minQuantity: number;
  maxQuantity: number;
  displayOrder: number;
  isActive: boolean;
  archivedAt: Date | null;
  updatedAt: Date;
}

export type ProductChanges = Partial<
  Pick<
    Product,
    | 'name'
    | 'robuxAmount'
    | 'fulfillmentMethod'
    | 'productLine'
    | 'minQuantity'
    | 'maxQuantity'
    | 'displayOrder'
  >
>;

/**
 * What a customer buys must not change under existing orders: once a product has orders, its
 * amount, product line and fulfillment method are locked. Create a new product instead.
 */
const IDENTITY_FIELDS: readonly (keyof ProductChanges)[] = [
  'robuxAmount',
  'fulfillmentMethod',
  'productLine',
];

/** Gamepass delivery (Phase 12) is a Robux mechanism; other lines are always INSTANT. */
export function assertMethodFitsLine(
  method: FulfillmentMethodName,
  productLine: ProductLineName,
): void {
  if (method !== 'INSTANT' && productLine !== 'ROBLOX_ROBUX') {
    throw new DomainError(
      ErrorCode.VALIDATION_FAILED,
      'Metode gamepass hanya tersedia untuk produk Robux.',
    );
  }
}

export function assertValidQuantityLimits(minQuantity: number, maxQuantity: number): void {
  if (minQuantity < 1 || maxQuantity < minQuantity || maxQuantity > PRODUCT_QUANTITY_CEILING) {
    throw new DomainError(
      ErrorCode.VALIDATION_FAILED,
      `Batas jumlah harus 1 ≤ minimum ≤ maksimum ≤ ${PRODUCT_QUANTITY_CEILING}.`,
    );
  }
}

export function assertChangesAllowed(
  product: Product,
  changes: ProductChanges,
  hasOrders: boolean,
): void {
  if (product.archivedAt) {
    throw new DomainError(
      ErrorCode.INVALID_PRODUCT_STATE,
      'Produk yang diarsipkan tidak dapat diubah.',
    );
  }
  const lockedField = IDENTITY_FIELDS.find(
    (field) => changes[field] !== undefined && changes[field] !== product[field],
  );
  if (hasOrders && lockedField) {
    throw new DomainError(
      ErrorCode.INVALID_PRODUCT_STATE,
      'Jumlah, jenis produk dan metode pengiriman tidak dapat diubah setelah ada pesanan. Buat produk baru.',
    );
  }
  assertMethodFitsLine(
    changes.fulfillmentMethod ?? product.fulfillmentMethod,
    changes.productLine ?? product.productLine,
  );
  assertValidQuantityLimits(
    changes.minQuantity ?? product.minQuantity,
    changes.maxQuantity ?? product.maxQuantity,
  );
}

/** A product can be sold only while it has a price in force. */
export function assertCanActivate(product: Product, hasActivePrice: boolean): void {
  if (product.archivedAt) {
    throw new DomainError(
      ErrorCode.INVALID_PRODUCT_STATE,
      'Produk yang diarsipkan tidak dapat diaktifkan.',
    );
  }
  if (!hasActivePrice) {
    throw new DomainError(
      ErrorCode.INVALID_PRODUCT_STATE,
      'Produk belum memiliki harga yang berlaku dan tidak dapat diaktifkan.',
    );
  }
}
