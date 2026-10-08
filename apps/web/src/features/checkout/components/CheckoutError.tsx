'use client';

import { useTranslations } from 'next-intl';
import { Alert } from '@/components/feedback/Alert';
import { ApiErrorAlert } from '@/components/feedback/ApiErrorAlert';

/**
 * Order errors with checkout-specific guidance. A changed price is not a failure to hide: the
 * customer sees the new quote and confirms again.
 */
export function CheckoutError({ code }: { code: string | null }) {
  const t = useTranslations('checkout.errors');
  if (code === 'PRICE_CHANGED') {
    return <Alert tone="error">{t('priceChanged')}</Alert>;
  }
  if (code === 'STAFF_CANNOT_ORDER') {
    return <Alert tone="error">{t('staffCannotOrder')}</Alert>;
  }
  return <ApiErrorAlert code={code} />;
}
