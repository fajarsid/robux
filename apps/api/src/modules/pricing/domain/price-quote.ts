import { ErrorCode } from '@robux/shared';
import type Decimal from 'decimal.js';
import { DomainError } from '../../../common/errors/domain-error';
import { roundMoney } from './money';
import { CURRENT_PRICE_ADJUSTMENT_RULES, type PriceAdjustmentRules } from './price-adjustments';

export interface QuoteInput {
  unitPrice: Decimal;
  currency: string;
  quantity: number;
  minQuantity: number;
  maxQuantity: number;
  robuxAmount: number;
}

export interface PriceQuote {
  currency: string;
  quantity: number;
  unitPrice: Decimal;
  subtotal: Decimal;
  discount: Decimal;
  fee: Decimal;
  tax: Decimal;
  total: Decimal;
  totalRobux: number;
}

/**
 * The only place an amount payable is computed. The quote endpoint and order creation both call
 * it; the order stores its result as the snapshot, and the frontend only displays it.
 */
export function quotePrice(
  input: QuoteInput,
  rules: PriceAdjustmentRules = CURRENT_PRICE_ADJUSTMENT_RULES,
): PriceQuote {
  if (
    !Number.isInteger(input.quantity) ||
    input.quantity < input.minQuantity ||
    input.quantity > input.maxQuantity
  ) {
    throw new DomainError(
      ErrorCode.QUANTITY_OUT_OF_RANGE,
      `Jumlah harus antara ${input.minQuantity} dan ${input.maxQuantity}.`,
    );
  }
  const context = {
    currency: input.currency,
    quantity: input.quantity,
    robuxAmount: input.robuxAmount,
  };
  const round = (amount: Decimal) => roundMoney(amount, input.currency);

  const subtotal = round(input.unitPrice.mul(input.quantity));
  const discount = round(rules.discount(subtotal, context));
  if (discount.isNegative() || discount.gt(subtotal)) {
    throw new Error('Discount rule produced an amount outside [0, subtotal]');
  }
  const afterDiscount = subtotal.minus(discount);
  const fee = round(rules.fee(afterDiscount, context));
  const tax = round(rules.tax(afterDiscount.plus(fee), context));
  if (fee.isNegative() || tax.isNegative()) {
    throw new Error('Fee and tax rules must not produce negative amounts');
  }
  return {
    currency: input.currency,
    quantity: input.quantity,
    unitPrice: input.unitPrice,
    subtotal,
    discount,
    fee,
    tax,
    total: afterDiscount.plus(fee).plus(tax),
    totalRobux: input.robuxAmount * input.quantity,
  };
}
