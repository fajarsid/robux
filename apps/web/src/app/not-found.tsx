import { getTranslations } from 'next-intl/server';
import { PageShell } from '@/components/layout/PageShell';
import { ButtonLink } from '@/components/ui/ButtonLink';

export default async function NotFound() {
  const t = await getTranslations('notFound');
  return (
    <PageShell className="py-24">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <p className="mt-3 text-muted-foreground">{t('body')}</p>
      <ButtonLink href="/" variant="link" className="mt-6">
        {t('back')}
      </ButtonLink>
    </PageShell>
  );
}
