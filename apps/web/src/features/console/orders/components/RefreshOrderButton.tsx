'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { Button } from '@/components/ui/Button';

/** Manual refresh: re-renders the order from the API. No polling until live updates exist. */
export function RefreshOrderButton() {
  const t = useTranslations('adminOrders.detail');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="md"
      icon="refresh"
      loading={pending}
      onClick={() => startTransition(() => router.refresh())}
    >
      {pending ? t('refreshing') : t('refresh')}
    </Button>
  );
}
