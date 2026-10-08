import { useTranslations } from 'next-intl';
import { LoadingRegion, Skeleton } from '@/components/feedback/Skeleton';

/** Placeholder with the detail page's shape while the order renders on the server. */
export function OrderDetailSkeleton() {
  const t = useTranslations('adminOrders.detail');
  return (
    <LoadingRegion label={t('loading')}>
      <Skeleton className="h-8 w-64" />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Skeleton className="h-32" />
          <Skeleton className="h-64" />
        </div>
        <div className="flex flex-col gap-6">
          <Skeleton className="h-40" />
          <Skeleton className="h-56" />
        </div>
      </div>
    </LoadingRegion>
  );
}
