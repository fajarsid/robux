import type { PriceBreakdownView } from '@robux/shared';
import { useTranslations } from 'next-intl';
import { PriceBreakdown } from '@/features/pricing/components/PriceBreakdown';

/** The amounts the customer will pay, as quoted by the API; never computed in the browser. */
export function OrderSummary({ pricing }: { pricing: PriceBreakdownView | null }) {
  const t = useTranslations('checkout');
  return (
    <div aria-live="polite">
      <h2 className="mb-3 text-sm font-semibold">{t('summary')}</h2>
      {pricing ? (
        <PriceBreakdown pricing={pricing} />
      ) : (
        <p className="text-sm text-muted-foreground">{t('calculating')}</p>
      )}
    </div>
  );
}
