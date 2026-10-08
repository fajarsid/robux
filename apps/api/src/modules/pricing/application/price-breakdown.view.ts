import type { PriceBreakdownView } from '@robux/shared';
import type Decimal from 'decimal.js';
import { formatMoneyAmount } from '../domain/money';

export interface PriceBreakdown {
  currency: string;
  unitPrice: Decimal;
  quantity: number;
  subtotal: Decimal;
  discount: Decimal;
  fee: Decimal;
  tax: Decimal;
  total: Decimal;
}

/** One presentation of amounts for quotes and stored order snapshots alike. */
export function toPriceBreakdownView(breakdown: PriceBreakdown): PriceBreakdownView {
  return {
    currency: breakdown.currency,
    unitPrice: formatMoneyAmount(breakdown.unitPrice),
    quantity: breakdown.quantity,
    subtotal: formatMoneyAmount(breakdown.subtotal),
    discount: formatMoneyAmount(breakdown.discount),
    fee: formatMoneyAmount(breakdown.fee),
    tax: formatMoneyAmount(breakdown.tax),
    total: formatMoneyAmount(breakdown.total),
  };
}
