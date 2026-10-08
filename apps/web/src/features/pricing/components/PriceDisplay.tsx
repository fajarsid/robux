import { formatMoney } from '@/lib/format/format';

const SIZE_CLASSES = {
  sm: 'text-sm',
  md: 'text-base font-medium',
  lg: 'text-2xl font-semibold',
} as const;

/** Renders an API-provided amount. It never computes prices; it only formats them. */
export function PriceDisplay({
  amount,
  currency,
  size = 'md',
}: {
  amount: string;
  currency: string;
  size?: keyof typeof SIZE_CLASSES;
}) {
  return (
    <span className={`tabular-nums ${SIZE_CLASSES[size]}`}>{formatMoney(amount, currency)}</span>
  );
}
