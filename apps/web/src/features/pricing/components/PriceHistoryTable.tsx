'use client';

import type { AdminPriceVersionView } from '@robux/shared';
import { useTranslations } from 'next-intl';
import { DataTable, type DataTableColumn } from '@/components/data-display/DataTable';
import { StatusBadge, type StatusTone } from '@/components/data-display/StatusBadge';
import { useClientPagination } from '@/components/data-display/useClientPagination';
import { formatDateTime } from '@/lib/format/format';
import { PriceDisplay } from './PriceDisplay';

const STATUS_TONES: Record<AdminPriceVersionView['status'], StatusTone> = {
  ACTIVE: 'success',
  SCHEDULED: 'progress',
  SUPERSEDED: 'neutral',
};

/** Read-only history: versions are immutable, so there are no edit actions here. */
export function PriceHistoryTable({ prices }: { prices: AdminPriceVersionView[] }) {
  const t = useTranslations('pricing');
  // Costs and margins are sent only to roles with pricing.write; OPERATOR sees neither column.
  const showCosts = prices.some((price) => price.costPrice !== undefined);
  const { pageRows, pagination } = useClientPagination(prices);

  const columns: DataTableColumn<AdminPriceVersionView>[] = [
    {
      id: 'version',
      header: t('version'),
      className: 'tabular-nums',
      cell: (price) => `v${price.version}`,
    },
    {
      id: 'status',
      header: t('status'),
      cell: (price) => (
        <StatusBadge tone={STATUS_TONES[price.status]}>
          {t(`versionStatus.${price.status}`)}
        </StatusBadge>
      ),
    },
    {
      id: 'selling',
      header: t('sellingPrice'),
      align: 'end',
      cell: (price) => (
        <PriceDisplay amount={price.sellingPrice} currency={price.currency} size="sm" />
      ),
    },
    ...(showCosts
      ? ([
          {
            id: 'cost',
            header: t('costPrice'),
            align: 'end',
            cell: (price) =>
              price.costPrice && (
                <PriceDisplay amount={price.costPrice} currency={price.currency} size="sm" />
              ),
          },
          {
            id: 'margin',
            header: t('margin'),
            align: 'end',
            cell: (price) =>
              price.margin && (
                <PriceDisplay amount={price.margin} currency={price.currency} size="sm" />
              ),
          },
        ] satisfies DataTableColumn<AdminPriceVersionView>[])
      : []),
    {
      id: 'effectiveFrom',
      header: t('effectiveFrom'),
      className: 'whitespace-nowrap text-muted-foreground',
      cell: (price) => formatDateTime(price.effectiveFrom),
    },
  ];

  return (
    <DataTable
      caption={t('historyTitle')}
      columns={columns}
      rows={pageRows}
      rowKey={(price) => price.id}
      pagination={pagination}
    />
  );
}
