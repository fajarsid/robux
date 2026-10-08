import type { PriceBreakdownView } from '@robux/shared';
import { useTranslations } from 'next-intl';
import { formatMoney } from '@/lib/format/format';

/**
 * Every amount of an order or quote exactly as the API computed it. Discount, fee and tax rows
 * are always shown, so a future non-zero value needs no UI change.
 */
export function PriceBreakdown({ pricing }: { pricing: PriceBreakdownView }) {
  const t = useTranslations('pricing.breakdown');
  const money = (amount: string) => formatMoney(amount, pricing.currency);
  const rows: [string, string][] = [
    [t('unitPrice'), money(pricing.unitPrice)],
    [t('quantity'), String(pricing.quantity)],
    [t('subtotal'), money(pricing.subtotal)],
    [t('discount'), money(pricing.discount)],
    [t('fee'), money(pricing.fee)],
    [t('tax'), money(pricing.tax)],
  ];
  return (
    <dl className="flex flex-col gap-2 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-4">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="tabular-nums">{value}</dd>
        </div>
      ))}
      <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-border pt-3">
        <dt className="font-semibold">{t('total')}</dt>
        <dd className="text-xl font-semibold tabular-nums">{money(pricing.total)}</dd>
      </div>
      <div className="flex justify-between gap-4 text-xs text-muted-foreground">
        <dt>{t('currency')}</dt>
        <dd>{pricing.currency}</dd>
      </div>
    </dl>
  );
}
