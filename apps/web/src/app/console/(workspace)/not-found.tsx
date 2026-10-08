import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { CONSOLE_ROUTES } from '@/features/console/routes';

/** Rendered inside the console shell, so navigation stays available. */
export default async function ConsoleNotFound() {
  const t = await getTranslations('console.notFound');
  return (
    <EmptyState
      title={t('title')}
      description={t('body')}
      action={
        <ButtonLink href={CONSOLE_ROUTES.home} variant="outline" size="md">
          {t('back')}
        </ButtonLink>
      }
    />
  );
}
