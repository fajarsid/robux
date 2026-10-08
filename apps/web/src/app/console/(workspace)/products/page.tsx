import type { AdminProductView } from '@robux/shared';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Breadcrumb } from '@/components/layout/Breadcrumb';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert } from '@/components/feedback/Alert';
import { CONSOLE_ROUTES } from '@/features/console/routes';
import { CreateProductDialog } from '@/features/products/components/admin/CreateProductDialog';
import { ProductTable } from '@/features/products/components/admin/ProductTable';
import { serverApiGet } from '@/lib/api/server-api';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('adminProducts'))('title') };
}

export default async function ConsoleProductsPage() {
  const [t, tConsole, products] = await Promise.all([
    getTranslations('adminProducts'),
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
        actions={<CreateProductDialog />}
      />
      {products ? (
        <ProductTable products={products} />
      ) : (
        <Alert tone="error">{t('loadFailed')}</Alert>
      )}
    </>
  );
}
