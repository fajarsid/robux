import { ErrorCode, type PriceVersionStatus } from '@robux/shared';
import type Decimal from 'decimal.js';
import { DomainError } from '../../../common/errors/domain-error';
import { isWholeMinorUnits } from './money';

export interface PriceVersion {
  id: string;
  productId: string;
  version: number;
  sellingPrice: Decimal;
  costPrice: Decimal;
  starsAmount?: number | null;
  currency: string;
  effectiveFrom: Date;
  createdAt: Date;
}

/** The price in force at `at`: the latest version whose effective date has been reached. */
export function selectActivePrice<T extends Pick<PriceVersion, 'version' | 'effectiveFrom'>>(
  prices: readonly T[],
  at: Date,
): T | null {
  let active: T | null = null;
  for (const price of prices) {
    if (price.effectiveFrom > at) {
      continue;
    }
    if (
      !active ||
      price.effectiveFrom > active.effectiveFrom ||
      (price.effectiveFrom.getTime() === active.effectiveFrom.getTime() &&
        price.version > active.version)
    ) {
      active = price;
    }
  }
  return active;
}

export function priceVersionStatus(
  price: Pick<PriceVersion, 'id' | 'effectiveFrom'>,
  activeId: string | null,
  at: Date,
): PriceVersionStatus {
  if (price.id === activeId) {
    return 'ACTIVE';
  }
  return price.effectiveFrom > at ? 'SCHEDULED' : 'SUPERSEDED';
}

export interface NewPriceInput {
  sellingPrice: Decimal;
  costPrice: Decimal;
  currency: string;
  confirmBelowCost?: boolean;
  starsAmount?: number;
}

/** The single set of rules every new price version must satisfy. */
export function assertValidNewPrice(input: NewPriceInput): void {
  const violation = (message: string) => new DomainError(ErrorCode.PRICING_RULE_VIOLATION, message);
  if (input.sellingPrice.lte(0)) {
    throw violation('Harga jual harus lebih dari 0.');
  }
  if (input.costPrice.lt(0)) {
    throw violation('Harga modal tidak boleh negatif.');
  }
  if (
    !isWholeMinorUnits(input.sellingPrice, input.currency) ||
    !isWholeMinorUnits(input.costPrice, input.currency)
  ) {
    throw violation('Harga dalam Rupiah harus berupa bilangan bulat.');
  }
  if (input.sellingPrice.lt(input.costPrice) && !input.confirmBelowCost) {
    throw violation('Harga jual di bawah harga modal memerlukan konfirmasi.');
  }
}

export function marginOf(price: Pick<PriceVersion, 'sellingPrice' | 'costPrice'>): Decimal {
  return price.sellingPrice.minus(price.costPrice);
}
