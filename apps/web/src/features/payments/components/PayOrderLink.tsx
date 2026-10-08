import { useTranslations } from 'next-intl';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { paymentHref } from '../payment-links';
import type { OrderAccess } from '../types/payment.types';

/** Entry to the payment page from an unpaid order. */
export function PayOrderLink({ access }: { access: OrderAccess }) {
  const t = useTranslations('payment');
  return (
    <ButtonLink href={paymentHref(access)} rel="noreferrer">
      {t('payNow')}
    </ButtonLink>
  );
}
