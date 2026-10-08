'use client';

import type { AdminProductView } from '@robux/shared';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { DataTable, type DataTableColumn } from '@/components/data-display/DataTable';
import { useClientPagination } from '@/components/data-display/useClientPagination';
import { EmptyState } from '@/components/feedback/EmptyState';
import { CONSOLE_ROUTES } from '@/features/console/routes';
import { PriceDisplay } from '@/features/pricing/components/PriceDisplay';
import { formatNumber } from '@/lib/format/format';
import { ProductStatusBadge } from '../ProductStatusBadge';
import { ProductRowActions } from './ProductActions';

/** Product list (all products come in one API response, so paging is client-side). */
export function ProductTable({ products }: { products: AdminProductView[] }) {
  const t = useTranslations('adminProducts');
  const tProducts = useTranslations('products');
  const { pageRows, pagination } = useClientPagination(products);

  const price = (product: AdminProductView) =>
    product.currentPrice ? (
      <PriceDisplay
        amount={product.currentPrice.sellingPrice}
        currency={product.currentPrice.currency}
        size="sm"
      />
    ) : (
      <span className="text-muted-foreground">{t('noPrice')}</span>
    );

  const columns: DataTableColumn<AdminProductView>[] = [
    {
      id: 'name',
      header: t('columns.name'),
      className: 'whitespace-nowrap',
      cell: (product) => (
        <Link href={CONSOLE_ROUTES.product(product.id)} className="group">
          <p className="font-medium group-hover:text-primary">{product.name}</p>
          <p className="font-mono text-xs text-muted-foreground">{product.slug}</p>
        </Link>
      ),
    },
    {
      id: 'platform',
      header: t('columns.platform'),
      className: 'whitespace-nowrap',
      cell: (product) => tProducts(`platform.${product.platform}`),
    },
    {
      id: 'line',
      header: t('columns.line'),
      className: 'whitespace-nowrap',
      cell: (product) => (
        <>
          <p>{tProducts(`productLine.${product.productLine}`)}</p>
          <p className="text-xs text-muted-foreground">
            {tProducts(`fulfillmentType.${product.fulfillmentType}`)}
          </p>
        </>
      ),
    },
    {
      id: 'robux',
      header: t('columns.robux'),
      align: 'end',
      className: 'tabular-nums',
      cell: (product) => formatNumber(product.robuxAmount),
    },
    {
      id: 'method',
      header: t('columns.method'),
      cell: (product) => tProducts(`method.${product.fulfillmentMethod}`),
    },
    {
      id: 'price',
      header: t('columns.price'),
      align: 'end',
      className: 'whitespace-nowrap',
      cell: price,
    },
    {
      id: 'status',
      header: t('columns.status'),
      cell: (product) => <ProductStatusBadge active={product.isActive} />,
    },
  ];

  return (
    <DataTable
      caption={t('title')}
      columns={columns}
      rows={pageRows}
      rowKey={(product) => product.id}
      pagination={pagination}
      actions={(product) => <ProductRowActions product={product} />}
      empty={<EmptyState icon="products" title={t('empty')} />}
      mobileCard={(product) => (
        <Link
          href={CONSOLE_ROUTES.product(product.id)}
          className="flex flex-col gap-2 rounded-panel border border-border bg-surface p-4 hover:border-primary-border"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-medium">{product.name}</p>
              <p className="font-mono text-xs text-muted-foreground">{product.slug}</p>
            </div>
            <ProductStatusBadge active={product.isActive} />
          </div>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">
              {tProducts(`platform.${product.platform}`)} ·{' '}
              {tProducts(`productLine.${product.productLine}`)} ·{' '}
              {tProducts(`fulfillmentType.${product.fulfillmentType}`)}
              <br />
              {tProducts(`unit.${product.unit}`, {
                amount: formatNumber(product.robuxAmount),
              })}{' '}
              · {tProducts(`method.${product.fulfillmentMethod}`)}
            </span>
            {price(product)}
          </div>
        </Link>
      )}
    />
  );
}
