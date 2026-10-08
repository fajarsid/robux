import { useTranslations } from 'next-intl';
import { LoadingRegion, Skeleton } from '@/components/feedback/Skeleton';

const ROWS = 6;

/** Placeholder with the list's shape while the first page renders on the server. */
export function OrderListSkeleton() {
  const t = useTranslations('adminOrders');
  return (
    <LoadingRegion label={t('loading')}>
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-9 w-full max-w-2xl" />
      <Skeleton className="h-32 w-full" />
      <div className="flex flex-col gap-2 rounded-panel border border-border p-4">
        {Array.from({ length: ROWS }, (_, index) => (
          <Skeleton key={index} className="h-9 w-full" />
        ))}
      </div>
    </LoadingRegion>
  );
}
