import { Inject, Injectable } from '@nestjs/common';
import { ErrorCode } from '@robux/shared';
import { DomainError } from '../../../common/errors/domain-error';
import { parseMoney } from '../domain/money';
import { assertValidNewPrice, type PriceVersion, selectActivePrice } from '../domain/price-version';
import {
  PRICE_VERSION_REPOSITORY,
  type PriceVersionRepository,
} from '../domain/price-version.repository';

/** All products are priced in IDR for now (D-06); stored per version so this can change later. */
export const DEFAULT_CURRENCY = 'IDR';

export interface NextPriceVersionInput {
  productId: string;
  basedOnVersion: number;
  sellingPrice: string;
  costPrice: string;
  effectiveFrom?: Date;
  confirmBelowCost?: boolean;
  starsAmount?: number;
  createdById?: string;
}

/** Owns product_prices: history, the price in force, and appending new versions. */
@Injectable()
export class PriceVersionService {
  constructor(@Inject(PRICE_VERSION_REPOSITORY) private readonly prices: PriceVersionRepository) {}

  history(productId: string): Promise<PriceVersion[]> {
    return this.prices.listForProduct(productId);
  }

  historyFor(productIds: readonly string[]): Promise<Map<string, PriceVersion[]>> {
    return this.prices.listForProducts(productIds);
  }

  activeFor(history: readonly PriceVersion[], at = new Date()): PriceVersion | null {
    return selectActivePrice(history, at);
  }

  /**
   * Appends version N+1 only when the caller saw version N (`basedOnVersion`). A stale view or a
   * double submit fails with PRICE_VERSION_CONFLICT instead of silently stacking versions. The
   * unique (product_id, version) constraint settles races between two concurrent requests.
   */
  async appendVersion(input: NextPriceVersionInput, now = new Date()): Promise<PriceVersion> {
    const history = await this.prices.listForProduct(input.productId);
    const latest = history[0]?.version ?? 0;
    if (input.basedOnVersion !== latest) {
      throw new DomainError(
        ErrorCode.PRICE_VERSION_CONFLICT,
        'Harga sudah diubah oleh orang lain. Muat ulang halaman.',
      );
    }
    const sellingPrice = parseMoney(input.sellingPrice);
    const costPrice = parseMoney(input.costPrice);
    assertValidNewPrice({
      sellingPrice,
      costPrice,
      currency: DEFAULT_CURRENCY,
      starsAmount: input.starsAmount,
      confirmBelowCost: input.confirmBelowCost,
    });
    const effectiveFrom = input.effectiveFrom ?? now;
    if (effectiveFrom < new Date(now.getTime() - 60_000)) {
      throw new DomainError(ErrorCode.PRICING_RULE_VIOLATION, 'Harga tidak dapat berlaku surut.');
    }
    const created = await this.prices.create({
      productId: input.productId,
      version: latest + 1,
      sellingPrice,
      costPrice,
      currency: DEFAULT_CURRENCY,
      starsAmount: input.starsAmount,
      effectiveFrom,
      createdById: input.createdById,
    });
    if (!created) {
      throw new DomainError(
        ErrorCode.PRICE_VERSION_CONFLICT,
        'Harga sudah diubah oleh orang lain. Muat ulang halaman.',
      );
    }
    return created;
  }
}
