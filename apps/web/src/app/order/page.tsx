import { getTranslations } from 'next-intl/server';
import { PageShell } from '@/components/layout/PageShell';
import { ButtonLink } from '@/components/ui/ButtonLink';

/** Orders are looked up by the private tracking link, never by order number (D-03). */
export default async function OrderLookupPage() {
  const t = await getTranslations('order');
  return (
    <PageShell className="max-w-2xl py-16">
      <h1 className="text-2xl font-semibold">{t('lookupTitle')}</h1>
      <p className="mt-3 text-muted-foreground">{t('lookupBody')}</p>
      <ButtonLink href="/login" variant="outline" className="mt-6">
        {t('lookupLogin')}
      </ButtonLink>
    </PageShell>
  );
}
