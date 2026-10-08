import Decimal from 'decimal.js';

export interface AdjustmentContext {
  currency: string;
  quantity: number;
  robuxAmount: number;
}

/**
 * The adjustable steps of the calculation chain subtotal → discount → fee → tax → total.
 * Each rule returns a non-negative amount in the order currency.
 */
export interface PriceAdjustmentRules {
  discount(subtotal: Decimal, context: AdjustmentContext): Decimal;
  fee(afterDiscount: Decimal, context: AdjustmentContext): Decimal;
  tax(taxableAmount: Decimal, context: AdjustmentContext): Decimal;
}

/**
 * D-06 (confirmed 2026-10-05): IDR, no discount, no customer fee, no tax. Introducing any of
 * them means replacing these rules; the quote, the order snapshot and the order engine stay as
 * they are.
 */
export const CURRENT_PRICE_ADJUSTMENT_RULES: PriceAdjustmentRules = {
  discount: () => new Decimal(0),
  fee: () => new Decimal(0),
  tax: () => new Decimal(0),
};
