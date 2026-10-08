'use client';

import { useTranslations } from 'next-intl';
import { Alert } from './Alert';

/** Maps an API error code to copy from the `errors` messages; never shows raw server text. */
export function ApiErrorAlert({ code }: { code: string | null }) {
  const t = useTranslations('errors');
  if (!code) {
    return null;
  }
  return <Alert tone="error">{t.has(code) ? t(code) : t('generic')}</Alert>;
}
