import Decimal from 'decimal.js';

/** Minor units per currency (DATABASE.md §3). IDR is charged in whole rupiah. */
const MINOR_UNITS: Readonly<Record<string, number>> = { IDR: 0 };

export function minorUnitsOf(currency: string): number {
  const units = MINOR_UNITS[currency];
  if (units === undefined) {
    throw new Error(`Unsupported currency ${currency}`);
  }
  return units;
}

export function parseMoney(value: string): Decimal {
  return new Decimal(value);
}

export function isWholeMinorUnits(amount: Decimal, currency: string): boolean {
  return amount.decimalPlaces() <= minorUnitsOf(currency);
}

/** Half-up to the currency minor unit, applied once per stored amount. */
export function roundMoney(amount: Decimal, currency: string): Decimal {
  return amount.toDecimalPlaces(minorUnitsOf(currency), Decimal.ROUND_HALF_UP);
}

/** API representation: always two decimals, e.g. "69000.00". */
export function formatMoneyAmount(amount: Decimal): string {
  return amount.toFixed(2);
}
