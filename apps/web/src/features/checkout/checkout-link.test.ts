import { describe, expect, it } from 'vitest';
import { checkoutHref, parseCheckoutQuantity } from './checkout-link';

describe('checkout link', () => {
  it('carries only the product slug and quantity', () => {
    expect(checkoutHref('robux-500', 3)).toBe('/checkout?product=robux-500&quantity=3');
  });

  it('falls back for anything that is not a small positive integer', () => {
    expect(parseCheckoutQuantity('4', 1)).toBe(4);
    for (const value of [undefined, '', '0', '-1', '1.5', 'abc', '1e3', '10000']) {
      expect(parseCheckoutQuantity(value, 1)).toBe(1);
    }
  });
});
