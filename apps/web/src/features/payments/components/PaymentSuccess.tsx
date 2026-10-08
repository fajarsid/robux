import type { PaymentView } from '@robux/shared';
import { useTranslations } from 'next-intl';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { formatDateTime, formatMoney } from '@/lib/format/format';

/**
 * Payment confirmed by the backend. Delivery is a separate step with its own status, so this
 * screen never says the Robux have arrived.
 */
export function PaymentSuccess({
  payment,
  orderHref,
}: {
  payment: PaymentView | null;
  orderHref: string;
}) {
  const t = useTranslations('payment');
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex h-10 w-10 items-center justify-center rounded-full border border-success/40 text-lg text-success"
        >
          ✓
        </span>
        <h2 className="text-xl font-semibold">{t('paid.title')}</h2>
      </div>
      <p className="text-muted-foreground">{t('paid.body')}</p>
      {payment && (
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-muted-foreground">{t('pending.amount')}</dt>
            <dd className="font-semibold tabular-nums">
              {formatMoney(payment.amount, payment.currency)}
            </dd>
          </div>
          {payment.paidAt && (
            <div>
              <dt className="text-sm text-muted-foreground">{t('paid.paidAt')}</dt>
              <dd className="font-medium">{formatDateTime(payment.paidAt)}</dd>
            </div>
          )}
        </dl>
      )}
      <p className="text-sm text-muted-foreground">{t('paid.fulfillment')}</p>
      <ButtonLink href={orderHref}>{t('viewOrder')}</ButtonLink>
    </div>
  );
}
