'use client';

import { useTranslations } from 'next-intl';
import { Alert } from '@/components/feedback/Alert';
import { ApiErrorAlert } from '@/components/feedback/ApiErrorAlert';

/**
 * The one mapping from API error codes to payment copy: payment-specific wording where the
 * generic text would mislead, the shared `errors` catalog for everything else.
 */
export function PaymentErrorAlert({ code }: { code: string | null }) {
  const t = useTranslations('payment.errors');
  if (code && t.has(code)) {
    return <Alert tone="error">{t(code)}</Alert>;
  }
  return <ApiErrorAlert code={code} />;
}
