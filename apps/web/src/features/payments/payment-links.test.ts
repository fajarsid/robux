import { describe, expect, it } from 'vitest';
import { orderHref, paymentHref, safeExternalUrl, safeImageUrl } from './payment-links';

describe('payment links', () => {
  it('builds the payment route next to the existing order routes', () => {
    expect(paymentHref({ kind: 'guest', trackingToken: 'tok_abc' })).toBe('/order/tok_abc/payment');
    expect(paymentHref({ kind: 'customer', orderId: 'o-1' })).toBe('/account/orders/o-1/payment');
    expect(orderHref({ kind: 'customer', orderId: 'o-1' })).toBe('/account/orders/o-1');
  });

  it('accepts only HTTPS URLs from the API as links', () => {
    expect(safeExternalUrl('https://example.com')).toBe('https://example.com/');
    expect(safeExternalUrl('https://pay.example.test/x')).toBe('https://pay.example.test/x');
    for (const rejected of [
      'http://example.com',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'ftp://example.com/x',
      'not a url',
      '//example.com/x',
      '',
    ]) {
      expect(safeExternalUrl(rejected)).toBeNull();
    }
    expect(safeExternalUrl(null)).toBeNull();
    expect(safeExternalUrl(undefined)).toBeNull();
  });

  it('accepts HTTPS images but not plain HTTP ones', () => {
    expect(safeImageUrl('https://cdn.example.test/bca.png')).toBe(
      'https://cdn.example.test/bca.png',
    );
    expect(safeImageUrl('http://cdn.example.test/bca.png')).toBeNull();
  });

  it('accepts image data URIs but no other data URIs', () => {
    expect(safeImageUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    expect(safeImageUrl('data:text/html,<script>')).toBeNull();
  });
});
