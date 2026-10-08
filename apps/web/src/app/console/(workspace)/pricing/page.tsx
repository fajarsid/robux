import type { AdminProductView } from '@robux/shared';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Alert } from '@/components/feedback/Alert';
import { Breadcrumb } from '@/components/layout/Breadcrumb';
import { PageHeader } from '@/components/layout/PageHeader';
import { CONSOLE_ROUTES } from '@/features/console/routes';
import { PricingOverviewTable } from '@/features/pricing/components/PricingOverviewTable';
import { serverApiGet } from '@/lib/api/server-api';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('pricing.overview'))('title') };
}

export default async function ConsolePricingPage() {
  const [t, tConsole, products] = await Promise.all([
    getTranslations('pricing.overview'),
    getTranslations('console'),
    serverApiGet<AdminProductView[]>('/admin/products'),
  ]);
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        breadcrumb={
          <Breadcrumb
            label={tConsole('breadcrumb')}
            items={[
              { label: tConsole('nav.dashboard'), href: CONSOLE_ROUTES.home },
              { label: t('title') },
            ]}
          />
        }
      />
      {products ? (
        <PricingOverviewTable products={products} />
      ) : (
        <Alert tone="error">{t('loadFailed')}</Alert>
      )}
    </>
  );
}
