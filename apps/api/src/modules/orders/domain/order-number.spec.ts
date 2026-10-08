import { formatOrderNumber, toBusinessDate } from './order-number';

describe('order number', () => {
  it('uses the Jakarta calendar date, not UTC', () => {
    // 2026-10-04T18:30Z is already 01:30 on 5 October in Jakarta (UTC+7).
    expect(toBusinessDate(new Date('2026-10-04T18:30:00Z'))).toEqual({
      iso: '2026-10-05',
      compact: '20261005',
    });
    expect(toBusinessDate(new Date('2026-10-04T16:59:59Z')).iso).toBe('2026-10-04');
  });

  it('formats RBX-YYYYMMDD-NNNNN with zero padding', () => {
    const day = toBusinessDate(new Date('2026-10-05T03:00:00Z'));
    expect(formatOrderNumber(day, 1)).toBe('RBX-20261005-00001');
    expect(formatOrderNumber(day, 12345)).toBe('RBX-20261005-12345');
  });

  it('keeps growing past five digits instead of wrapping', () => {
    const day = toBusinessDate(new Date('2026-10-05T03:00:00Z'));
    expect(formatOrderNumber(day, 100000)).toBe('RBX-20261005-100000');
  });

  it('rejects non-positive or fractional sequences', () => {
    const day = toBusinessDate(new Date());
    expect(() => formatOrderNumber(day, 0)).toThrow(RangeError);
    expect(() => formatOrderNumber(day, 1.5)).toThrow(RangeError);
  });
});
