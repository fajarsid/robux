import { maskIpAddress } from './audit-event';

describe('maskIpAddress', () => {
  it('keeps only the /24 of an IPv4 address', () => {
    expect(maskIpAddress('203.0.113.77')).toBe('203.0.113.0');
    expect(maskIpAddress('::ffff:203.0.113.77')).toBe('203.0.113.0');
  });

  it('keeps only the /48 of an IPv6 address', () => {
    expect(maskIpAddress('2001:db8:abcd:12:1:2:3:4')).toBe('2001:db8:abcd::');
  });

  it('passes through a missing address', () => {
    expect(maskIpAddress(undefined)).toBeUndefined();
  });
});
