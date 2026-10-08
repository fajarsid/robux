import type { CatalogProductView } from '@robux/shared';
import { getTranslations } from 'next-intl/server';
import { PageShell } from '@/components/layout/PageShell';
import { ProductGrid } from '@/features/products/components/ProductGrid';
import { serverApiGet } from '@/lib/api/server-api';

export default async function ProductsPage() {
  const [t, products] = await Promise.all([
    getTranslations('products'),
    serverApiGet<CatalogProductView[]>('/products'),
  ]);
  return (
    <PageShell className="py-10">
      <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="mt-2 max-w-2xl text-muted-foreground">{t('subtitle')}</p>
      <div className="mt-8">
        <ProductGrid products={products ?? []} />
      </div>
    </PageShell>
  );
}
