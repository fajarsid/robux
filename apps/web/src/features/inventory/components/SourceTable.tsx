'use client';

import type { AdminSourceView } from '@robux/shared';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { DataTable, type DataTableColumn } from '@/components/data-display/DataTable';
import { useClientPagination } from '@/components/data-display/useClientPagination';
import { EmptyState } from '@/components/feedback/EmptyState';
import { type DropdownItem, DropdownMenu } from '@/components/ui/DropdownMenu';
import { IconButton } from '@/components/ui/IconButton';
import { formatNumber } from '@/lib/format/format';
import { LowBalanceBadge, SourceHealthBadge, SourceStatusBadge } from './SourceBadges';
import { AdjustBalanceDialog, EditSourceDialog, SourceStatusDialog } from './SourceDialogs';

type OpenDialog = 'edit' | 'adjust' | 'status' | null;

const robux = (value: string) => formatNumber(Number(value));

/** Row menu; the dialog it opens is mounted only while open. */
function SourceRowActions({ source }: { source: AdminSourceView }) {
  const t = useTranslations('adminInventory');
  const [open, setOpen] = useState<OpenDialog>(null);
  const active = source.status === 'ACTIVE';
  const items: DropdownItem[] = [
    { label: t('edit'), icon: 'edit', onSelect: () => setOpen('edit') },
    { label: t('adjust'), icon: 'adjust', onSelect: () => setOpen('adjust') },
    {
      label: active ? t('deactivate') : t('activate'),
      icon: active ? 'error' : 'success',
      tone: active ? 'danger' : 'default',
      onSelect: () => setOpen('status'),
    },
  ];
  const close = () => setOpen(null);
  return (
    <>
      <DropdownMenu
        label={t('actionsFor', { name: source.name })}
        trigger={(props) => (
          <IconButton
            icon="more"
            label={t('actionsFor', { name: source.name })}
            size="sm"
            {...props}
          />
        )}
        items={items}
      />
      {open === 'edit' && <EditSourceDialog source={source} onClose={close} />}
      {open === 'adjust' && <AdjustBalanceDialog source={source} onClose={close} />}
      {open === 'status' && <SourceStatusDialog source={source} onClose={close} />}
    </>
  );
}

/** Every source comes in one API response, so paging is client-side. */
export function SourceTable({ sources }: { sources: AdminSourceView[] }) {
  const t = useTranslations('adminInventory');
  const tProducts = useTranslations('products');
  const { pageRows, pagination } = useClientPagination(sources);

  const columns: DataTableColumn<AdminSourceView>[] = [
    {
      id: 'source',
      header: t('columns.source'),
      className: 'whitespace-nowrap',
      cell: (source) => <span className="font-medium">{source.name}</span>,
    },
    {
      id: 'provider',
      header: t('columns.provider'),
      cell: (source) => <span className="font-mono text-xs">{source.provider}</span>,
    },
    {
      id: 'productLine',
      header: t('columns.productLine'),
      className: 'whitespace-nowrap',
      cell: (source) => tProducts(`productLine.${source.productLine}`),
    },
    {
      id: 'available',
      header: t('columns.available'),
      align: 'end',
      className: 'tabular-nums',
      cell: (source) => robux(source.availableBalance),
    },
    {
      id: 'reserved',
      header: t('columns.reserved'),
      align: 'end',
      className: 'tabular-nums',
      cell: (source) => robux(source.reservedBalance),
    },
    {
      id: 'status',
      header: t('columns.status'),
      cell: (source) => <SourceStatusBadge status={source.status} />,
    },
    {
      id: 'health',
      header: t('columns.health'),
      cell: (source) => <SourceHealthBadge health={source.health} />,
    },
    {
      id: 'priority',
      header: t('columns.priority'),
      align: 'end',
      className: 'tabular-nums',
      cell: (source) => source.priority,
    },
    {
      id: 'lowBalance',
      header: t('columns.lowBalance'),
      cell: (source) => <LowBalanceBadge low={source.lowBalance} />,
    },
  ];

  return (
    <DataTable
      caption={t('title')}
      columns={columns}
      rows={pageRows}
      rowKey={(source) => source.id}
      pagination={pagination}
      actions={(source) => <SourceRowActions source={source} />}
      empty={<EmptyState icon="inventory" title={t('empty')} description={t('emptyHint')} />}
      mobileCard={(source) => (
        <div className="flex flex-col gap-2 rounded-panel border border-border bg-surface p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-medium">{source.name}</p>
              <p className="font-mono text-xs text-muted-foreground">{source.provider}</p>
            </div>
            <SourceStatusBadge status={source.status} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SourceHealthBadge health={source.health} />
            {source.lowBalance && <LowBalanceBadge low />}
          </div>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">{t('columns.available')}</dt>
              <dd className="tabular-nums">{robux(source.availableBalance)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('columns.reserved')}</dt>
              <dd className="tabular-nums">{robux(source.reservedBalance)}</dd>
            </div>
          </dl>
        </div>
      )}
    />
  );
}
