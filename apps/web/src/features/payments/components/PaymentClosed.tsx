import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';

type RetryableReason = 'failed' | 'expired' | 'cancelled';

export type ClosedPaymentReason = RetryableReason | 'orderCancelled' | 'refund' | 'unavailable';

function isRetryable(reason: ClosedPaymentReason): reason is RetryableReason {
  return reason === 'failed' || reason === 'expired' || reason === 'cancelled';
}

interface PaymentClosedProps {
  reason: ClosedPaymentReason;
  /** From the API: whether another payment attempt may be started for this order. */
  canCreatePayment: boolean;
  orderHref: string;
  onRetry: () => void;
}

/** Any state where the customer cannot pay right now, with the next step the backend allows. */
export function PaymentClosed({
  reason,
  canCreatePayment,
  orderHref,
  onRetry,
}: PaymentClosedProps) {
  const t = useTranslations('payment');
  const retryReason = canCreatePayment && isRetryable(reason) ? reason : null;
  const showRetry = retryReason !== null;
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-xl font-semibold">{t(`closed.${reason}.title`)}</h2>
        <p className="mt-1 text-muted-foreground">{t(`closed.${reason}.body`)}</p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        {retryReason && <Button onClick={onRetry}>{t(`closed.${retryReason}.retry`)}</Button>}
        <ButtonLink href={orderHref} variant={showRetry ? 'outline' : 'primary'}>
          {t('viewOrder')}
        </ButtonLink>
      </div>
    </div>
  );
}
