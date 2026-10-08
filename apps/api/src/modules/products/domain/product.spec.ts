import { DomainError } from '../../../common/errors/domain-error';
import {
  assertCanActivate,
  assertChangesAllowed,
  assertMethodFitsLine,
  assertValidQuantityLimits,
  type Product,
} from './product';

const product: Product = {
  id: 'p1',
  slug: 'robux-500',
  name: 'Robux 500',
  robuxAmount: 500,
  fulfillmentMethod: 'INSTANT',
  productLine: 'ROBLOX_ROBUX',
  minQuantity: 1,
  maxQuantity: 10,
  displayOrder: 0,
  isActive: false,
  archivedAt: null,
  updatedAt: new Date(),
};

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (error) {
    return error instanceof DomainError ? error.code : 'UNEXPECTED';
  }
}

describe('product rules', () => {
  it('enforces 1 ≤ min ≤ max ≤ ceiling', () => {
    expect(codeOf(() => assertValidQuantityLimits(1, 10))).toBeUndefined();
    expect(codeOf(() => assertValidQuantityLimits(0, 10))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => assertValidQuantityLimits(5, 4))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => assertValidQuantityLimits(1, 101))).toBe('VALIDATION_FAILED');
  });

  it('locks the Robux amount and method once the product has orders', () => {
    expect(
      codeOf(() => assertChangesAllowed(product, { robuxAmount: 600 }, false)),
    ).toBeUndefined();
    expect(codeOf(() => assertChangesAllowed(product, { robuxAmount: 600 }, true))).toBe(
      'INVALID_PRODUCT_STATE',
    );
    expect(
      codeOf(() => assertChangesAllowed(product, { fulfillmentMethod: 'GAMEPASS' }, true)),
    ).toBe('INVALID_PRODUCT_STATE');
    expect(
      codeOf(() => assertChangesAllowed(product, { name: 'Robux 500 Hemat' }, true)),
    ).toBeUndefined();
    expect(codeOf(() => assertChangesAllowed(product, { robuxAmount: 500 }, true))).toBeUndefined();
  });

  it('validates quantity limits against the merged values', () => {
    expect(codeOf(() => assertChangesAllowed(product, { minQuantity: 20 }, false))).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('cannot activate without a price in force or when archived', () => {
    expect(codeOf(() => assertCanActivate(product, true))).toBeUndefined();
    expect(codeOf(() => assertCanActivate(product, false))).toBe('INVALID_PRODUCT_STATE');
    expect(codeOf(() => assertCanActivate({ ...product, archivedAt: new Date() }, true))).toBe(
      'INVALID_PRODUCT_STATE',
    );
  });

  it('locks the product line once the product has orders', () => {
    expect(() => assertChangesAllowed(product, { productLine: 'TELEGRAM_STARS' }, true)).toThrow(
      expect.objectContaining({ code: 'INVALID_PRODUCT_STATE' }),
    );
    expect(() =>
      assertChangesAllowed(product, { productLine: 'TELEGRAM_STARS' }, false),
    ).not.toThrow();
  });

  it('keeps gamepass delivery for Robux only', () => {
    expect(() => assertMethodFitsLine('GAMEPASS', 'ROBLOX_ROBUX')).not.toThrow();
    expect(() => assertMethodFitsLine('GAMEPASS', 'TELEGRAM_PREMIUM')).toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }),
    );
    expect(() =>
      assertChangesAllowed(
        product,
        { productLine: 'TELEGRAM_ACCOUNT', fulfillmentMethod: 'GAMEPASS' },
        false,
      ),
    ).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
  });
});
