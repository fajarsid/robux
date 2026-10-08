import { useTranslations } from 'next-intl';
import { LoadingRegion, Skeleton } from '@/components/feedback/Skeleton';

export default function ConsoleLoading() {
  const t = useTranslations('console');
  return (
    <LoadingRegion label={t('loading')}>
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-80 max-w-full" />
      <Skeleton className="h-64 w-full" />
    </LoadingRegion>
  );
}
