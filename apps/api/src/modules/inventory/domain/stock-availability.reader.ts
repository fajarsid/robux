import type { ProductLineName } from '@robux/shared';

export interface StockAvailabilityReader {
  /**
   * Units available right now per product line, across sources that can fulfil (ACTIVE and
   * HEALTHY/DEGRADED). A routing plan exists exactly when a line's total covers the amount.
   */
  availableByLine(): Promise<ReadonlyMap<ProductLineName, bigint>>;
}

export const STOCK_AVAILABILITY_READER = Symbol('STOCK_AVAILABILITY_READER');
