'use client';

import type { AdminProductView } from '@robux/shared';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { DataTable, type DataTableColumn } from '@/components/data-display/DataTable';
import { useClientPagination } from '@/components/data-display/useClientPagination';
import { EmptyState } from '@/components/feedback/EmptyState';
import { CONSOLE_ROUTES } from '@/features/console/routes';
import { ProductRowActions } from '@/features/products/components/admin/ProductActions';
import { formatDateTime } from '@/lib/format/format';
import { PriceDisplay } from './PriceDisplay';

/**
 * The price in force for every product, from the same product list the API already serves.
 * Prices are changed on the product page, where the version history and confirmation live.
 */
export function PricingOverviewTable({ products }: { products: AdminProductView[] }) {
  const t = useTranslations('pricing');
  const tOverview = useTranslations('pricing.overview');
  const { pageRows, pagination } = useClientPagination(products);
  // Costs and margins are present only for roles with pricing.write.
  const showCosts = products.some((product) => product.currentPrice?.costPrice !== undefined);
  const money = (amount: string | undefined, currency: string) =>
    amount ? <PriceDisplay amount={amount} currency={currency} size="sm" /> : null;

  const columns: DataTableColumn<AdminProductView>[] = [
    {
      id: 'product',
      header: tOverview('product'),
      className: 'whitespace-nowrap',
      cell: (product) => (
        <Link href={CONSOLE_ROUTES.product(product.id)} className="group">
          <p className="font-medium group-hover:text-primary">{product.name}</p>
          <p className="font-mono text-xs text-muted-foreground">{product.slug}</p>
        </Link>
      ),
    },
    {
      id: 'selling',
      header: t('sellingPrice'),
      align: 'end',
      className: 'whitespace-nowrap',
      cell: (product) =>
        product.currentPrice ? (
          money(product.currentPrice.sellingPrice, product.currentPrice.currency)
        ) : (
          <span className="text-muted-foreground">{tOverview('noPrice')}</span>
        ),
    },
    ...(showCosts
      ? ([
          {
            id: 'cost',
            header: t('costPrice'),
            align: 'end',
            className: 'whitespace-nowrap',
            cell: (product) =>
              product.currentPrice &&
              money(product.currentPrice.costPrice, product.currentPrice.currency),
          },
          {
            id: 'margin',
            header: t('margin'),
            align: 'end',
            className: 'whitespace-nowrap',
            cell: (product) =>
              product.currentPrice &&
              money(product.currentPrice.margin, product.currentPrice.currency),
          },
        ] satisfies DataTableColumn<AdminProductView>[])
      : []),
    {
      id: 'version',
      header: t('version'),
      className: 'tabular-nums text-muted-foreground',
      cell: (product) => (product.currentPrice ? `v${product.currentPrice.version}` : '—'),
    },
    {
      id: 'effectiveFrom',
      header: t('effectiveFrom'),
      className: 'whitespace-nowrap text-muted-foreground',
      cell: (product) =>
        product.currentPrice ? formatDateTime(product.currentPrice.effectiveFrom) : '—',
    },
  ];

  return (
    <DataTable
      caption={tOverview('title')}
      columns={columns}
      rows={pageRows}
      rowKey={(product) => product.id}
      pagination={pagination}
      actions={(product) => <ProductRowActions product={product} include={['view', 'price']} />}
      empty={<EmptyState icon="pricing" title={tOverview('empty')} />}
    />
  );
}
