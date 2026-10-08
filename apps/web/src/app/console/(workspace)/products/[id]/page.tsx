import type { AdminProductDetailView } from '@robux/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Breadcrumb } from '@/components/layout/Breadcrumb';
import { PageHeader } from '@/components/layout/PageHeader';
import { Panel } from '@/components/layout/Panel';
import { CONSOLE_ROUTES } from '@/features/console/routes';
import { PriceDisplay } from '@/features/pricing/components/PriceDisplay';
import { PriceHistoryTable } from '@/features/pricing/components/PriceHistoryTable';
import { ProductHeaderActions } from '@/features/products/components/admin/ProductActions';
import { ProductStatusBadge } from '@/features/products/components/ProductStatusBadge';
import { serverApiGet } from '@/lib/api/server-api';
import { formatNumber } from '@/lib/format/format';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fetchProduct(id: string) {
  return UUID.test(id)
    ? serverApiGet<AdminProductDetailView>(`/admin/products/${encodeURIComponent(id)}`)
    : Promise.resolve(null);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  return { title: (await fetchProduct((await params).id))?.name };
}

/** Product detail: facts and price history. Edit, status and new price open dialogs. */
export default async function ConsoleProductPage({ params }: { params: Promise<{ id: string }> }) {
  const product = await fetchProduct((await params).id);
  if (!product) {
    notFound();
  }
  const [t, tPricing, tProducts, tConsole] = await Promise.all([
    getTranslations('adminProducts'),
    getTranslations('pricing'),
    getTranslations('products'),
    getTranslations('console'),
  ]);

  const facts: [string, React.ReactNode][] = [
    [t('fields.productLine'), tProducts(`productLine.${product.productLine}`)],
    [t('fields.platform'), tProducts(`platform.${product.platform}`)],
    [t('fields.fulfillmentType'), tProducts(`fulfillmentType.${product.fulfillmentType}`)],
    [
      t('fields.robuxAmount'),
      tProducts(`unit.${product.unit}`, { amount: formatNumber(product.robuxAmount) }),
    ],
    [t('fields.method'), tProducts(`method.${product.fulfillmentMethod}`)],
    [t('fields.minQuantity'), formatNumber(product.minQuantity)],
    [t('fields.maxQuantity'), formatNumber(product.maxQuantity)],
    [t('fields.displayOrder'), formatNumber(product.displayOrder)],
    [
      t('columns.price'),
      product.currentPrice ? (
        <PriceDisplay
          amount={product.currentPrice.sellingPrice}
          currency={product.currentPrice.currency}
          size="sm"
        />
      ) : (
        t('noPrice')
      ),
    ],
  ];

  return (
    <>
      <PageHeader
        title={product.name}
        breadcrumb={
          <Breadcrumb
            label={tConsole('breadcrumb')}
            items={[
              { label: tConsole('nav.dashboard'), href: CONSOLE_ROUTES.home },
              { label: t('title'), href: CONSOLE_ROUTES.products },
              { label: product.name },
            ]}
          />
        }
        meta={
          <>
            <ProductStatusBadge active={product.isActive} />
            <span className="font-mono">{product.slug}</span>
          </>
        }
        actions={<ProductHeaderActions product={product} />}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title={t('detailsTitle')} className="lg:col-span-1">
          <dl className="flex flex-col gap-3 text-sm">
            {facts.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="text-right font-medium">{value}</dd>
              </div>
            ))}
          </dl>
          {product.hasOrders && (
            <p className="mt-4 text-xs text-muted-foreground">{t('lockedHint')}</p>
          )}
        </Panel>
        <Panel
          title={tPricing('historyTitle')}
          description={tPricing('historyHint')}
          className="min-w-0 lg:col-span-2"
        >
          <PriceHistoryTable prices={product.prices} />
        </Panel>
      </div>
    </>
  );
}
