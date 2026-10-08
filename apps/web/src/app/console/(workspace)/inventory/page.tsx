import type { AdminProductView, AdminSourceView, DigitalAccountInventoryView } from '@robux/shared';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Alert } from '@/components/feedback/Alert';
import { Breadcrumb } from '@/components/layout/Breadcrumb';
import { PageHeader } from '@/components/layout/PageHeader';
import { CONSOLE_ROUTES } from '@/features/console/routes';
import { CreateSourceDialog } from '@/features/inventory/components/CreateSourceDialog';
import { SourceTable } from '@/features/inventory/components/SourceTable';
import { DigitalAccountInventory } from '@/features/inventory/components/DigitalAccountInventory';
import { serverApiGet } from '@/lib/api/server-api';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('adminInventory'))('title') };
}

export default async function ConsoleInventoryPage() {
  const [t, tConsole, sources, accountItems, products] = await Promise.all([
    getTranslations('adminInventory'),
    getTranslations('console'),
    serverApiGet<AdminSourceView[]>('/admin/inventory/sources'),
    serverApiGet<DigitalAccountInventoryView[]>('/admin/inventory/accounts'),
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
        actions={<CreateSourceDialog />}
      />
      {sources ? <SourceTable sources={sources} /> : <Alert tone="error">{t('loadFailed')}</Alert>}
      {accountItems && products && sources ? <DigitalAccountInventory
        initialItems={accountItems}
        products={products.filter((product) => product.productLine === 'TELEGRAM_ACCOUNT')}
        sources={sources.filter((source) => source.productLine === 'TELEGRAM_ACCOUNT')}
      /> : <Alert tone="error">{t('loadFailed')}</Alert>}
    </>
  );
}
