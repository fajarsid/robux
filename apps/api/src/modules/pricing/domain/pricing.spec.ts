import Decimal from 'decimal.js';
import { DomainError } from '../../../common/errors/domain-error';
import { isWholeMinorUnits, roundMoney } from './money';
import { quotePrice } from './price-quote';
import { assertValidNewPrice, priceVersionStatus, selectActivePrice } from './price-version';

const d = (value: string | number) => new Decimal(value);

function expectDomainError(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
    return;
  }
  throw new Error(`Expected DomainError ${code}`);
}

describe('money', () => {
  it('treats IDR as whole rupiah', () => {
    expect(isWholeMinorUnits(d('69000'), 'IDR')).toBe(true);
    expect(isWholeMinorUnits(d('69000.00'), 'IDR')).toBe(true);
    expect(isWholeMinorUnits(d('69000.5'), 'IDR')).toBe(false);
  });

  it('rounds half-up to the currency unit', () => {
    expect(roundMoney(d('1000.5'), 'IDR').toString()).toBe('1001');
    expect(roundMoney(d('1000.49'), 'IDR').toString()).toBe('1000');
  });
});

describe('selectActivePrice', () => {
  const at = new Date('2026-10-05T12:00:00Z');
  const version = (n: number, iso: string) => ({
    id: `v${n}`,
    version: n,
    effectiveFrom: new Date(iso),
  });

  it('picks the latest version already in effect and ignores scheduled ones', () => {
    const prices = [
      version(1, '2026-01-01T00:00:00Z'),
      version(2, '2026-06-01T00:00:00Z'),
      version(3, '2026-12-01T00:00:00Z'),
    ];
    expect(selectActivePrice(prices, at)?.version).toBe(2);
    expect(priceVersionStatus(prices[2]!, 'v2', at)).toBe('SCHEDULED');
    expect(priceVersionStatus(prices[0]!, 'v2', at)).toBe('SUPERSEDED');
    expect(priceVersionStatus(prices[1]!, 'v2', at)).toBe('ACTIVE');
  });

  it('breaks a tie on effective date by the higher version', () => {
    const prices = [version(1, '2026-01-01T00:00:00Z'), version(2, '2026-01-01T00:00:00Z')];
    expect(selectActivePrice(prices, at)?.version).toBe(2);
  });

  it('returns null when nothing is in effect yet', () => {
    expect(selectActivePrice([version(1, '2027-01-01T00:00:00Z')], at)).toBeNull();
  });
});

describe('assertValidNewPrice', () => {
  const base = { sellingPrice: d(69000), costPrice: d(50000), currency: 'IDR' };

  it('accepts a normal price', () => {
    expect(() => assertValidNewPrice(base)).not.toThrow();
  });

  it.each([
    ['zero selling price', { sellingPrice: d(0) }],
    ['negative cost', { costPrice: d(-1) }],
    ['fractional rupiah', { sellingPrice: d('69000.50') }],
    ['below cost without confirmation', { sellingPrice: d(40000) }],
  ])('rejects %s', (_label, change) => {
    expectDomainError(() => assertValidNewPrice({ ...base, ...change }), 'PRICING_RULE_VIOLATION');
  });

  it('accepts a selling price below cost once confirmed', () => {
    expect(() =>
      assertValidNewPrice({ ...base, sellingPrice: d(40000), confirmBelowCost: true }),
    ).not.toThrow();
  });
});

describe('quotePrice', () => {
  const input = {
    unitPrice: d(69000),
    currency: 'IDR',
    minQuantity: 1,
    maxQuantity: 10,
    robuxAmount: 500,
  };

  it('computes subtotal, total and Robux for a quantity', () => {
    const quote = quotePrice({ ...input, quantity: 3 });
    expect(quote.subtotal.toString()).toBe('207000');
    expect(quote.total.toString()).toBe('207000');
    expect(quote.discount.toString()).toBe('0');
    expect(quote.fee.toString()).toBe('0');
    expect(quote.tax.toString()).toBe('0');
    expect(quote.totalRobux).toBe(1500);
  });

  it.each([0, 11, 1.5, -1])('rejects quantity %s outside the product limits', (quantity) => {
    expectDomainError(() => quotePrice({ ...input, quantity }), 'QUANTITY_OUT_OF_RANGE');
  });

  it('runs the chain subtotal, discount, fee, tax, total with non-zero rules', () => {
    const rules = {
      discount: (subtotal: Decimal) => subtotal.mul('0.1'),
      fee: () => d(2500),
      tax: (taxable: Decimal) => taxable.mul('0.11'),
    };
    const quote = quotePrice({ ...input, quantity: 2 }, rules);
    expect(quote.subtotal.toString()).toBe('138000');
    expect(quote.discount.toString()).toBe('13800');
    expect(quote.fee.toString()).toBe('2500');
    // (138000 - 13800 + 2500) x 11% = 13937 after rounding to whole rupiah.
    expect(quote.tax.toString()).toBe('13937');
    expect(quote.total.toString()).toBe('140637');
  });

  it('refuses rules that give a discount above the subtotal or a negative amount', () => {
    const zero = () => d(0);
    expect(() =>
      quotePrice(
        { ...input, quantity: 1 },
        { discount: (s: Decimal) => s.plus(1), fee: zero, tax: zero },
      ),
    ).toThrow();
    expect(() =>
      quotePrice({ ...input, quantity: 1 }, { discount: zero, fee: () => d(-1), tax: zero }),
    ).toThrow();
  });
});
