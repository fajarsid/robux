export const ORDER_NUMBER_TIME_ZONE = 'Asia/Jakarta';

const SEQUENCE_DIGITS = 5;

export interface BusinessDate {
  /** `YYYY-MM-DD`, the counter key. */
  iso: string;
  /** `YYYYMMDD`, the order number segment. */
  compact: string;
}

/** Order numbers roll over at midnight in Jakarta, not UTC, so customers see their local date. */
export function toBusinessDate(instant: Date): BusinessDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ORDER_NUMBER_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  const [year, month, day] = [part('year'), part('month'), part('day')];
  return { iso: `${year}-${month}-${day}`, compact: `${year}${month}${day}` };
}

export function formatOrderNumber(businessDate: BusinessDate, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new RangeError('Order number sequence must be a positive integer');
  }
  return `RBX-${businessDate.compact}-${String(sequence).padStart(SEQUENCE_DIGITS, '0')}`;
}
