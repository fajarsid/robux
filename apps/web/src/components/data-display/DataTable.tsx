import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Alert } from '@/components/feedback/Alert';
import { Skeleton } from '@/components/feedback/Skeleton';
import { formatNumber } from '@/lib/format/format';
import { PageSizeSelect } from './PageSizeSelect';
import { Pagination } from './Pagination';

export interface DataTableColumn<Row> {
  id: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  align?: 'start' | 'end';
  /** Applied to the cells of this column, e.g. `whitespace-nowrap`. */
  className?: string;
}

/** Server- or client-side paging; DataTable only renders the footer and reports changes. */
export interface DataTablePagination {
  page: number;
  pageSize: number;
  total: number;
  pending?: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

interface DataTableProps<Row> {
  /** Accessible table name. */
  caption: string;
  columns: DataTableColumn<Row>[];
  /** The rows of the current page only. */
  rows: Row[];
  rowKey: (row: Row) => string;
  pagination?: DataTablePagination;
  /** Narrow screens show one card per row; omit to scroll the table horizontally instead. */
  mobileCard?: (row: Row) => ReactNode;
  /** Trailing per-row actions (typically a DropdownMenu). */
  actions?: (row: Row) => ReactNode;
  loading?: boolean;
  /** Message shown instead of rows when loading failed. */
  error?: string;
  /** Shown instead of the table when there are no rows. */
  empty?: ReactNode;
}

const ALIGN = { start: 'text-left', end: 'text-right' } as const;
const SKELETON_ROWS = 5;

/**
 * The one table of the console (ENGINEERING_STANDARDS.md §4.4). First column "No." counts across
 * pages; the footer has the page-size selector on the left and the pager on the right. Feature
 * code supplies typed columns and rows only.
 */
export function DataTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
  pagination,
  mobileCard,
  actions,
  loading = false,
  error,
  empty,
}: DataTableProps<Row>) {
  const t = useTranslations('common.table');
  if (error) {
    return <Alert tone="error">{error}</Alert>;
  }
  if (!loading && rows.length === 0 && empty) {
    return <>{empty}</>;
  }
  const offset = pagination ? (pagination.page - 1) * pagination.pageSize : 0;
  const numberOf = (index: number) => formatNumber(offset + index + 1);
  const allColumns = columns.length + 1 + (actions ? 1 : 0);

  return (
    <div className="flex flex-col gap-3" aria-busy={loading || pagination?.pending}>
      <div
        className={`relative overflow-x-auto rounded-panel border border-border bg-surface ${mobileCard ? 'hidden md:block' : ''}`}
      >
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-surface-muted">
            <tr>
              <th
                scope="col"
                className="w-12 border-b border-border px-4 py-2.5 text-left text-xs font-medium whitespace-nowrap text-muted-foreground uppercase"
              >
                {t('number')}
              </th>
              {columns.map((column) => (
                <th
                  key={column.id}
                  scope="col"
                  className={`border-b border-border px-4 py-2.5 text-xs font-medium tracking-wide whitespace-nowrap text-muted-foreground uppercase ${ALIGN[column.align ?? 'start']}`}
                >
                  {column.header}
                </th>
              ))}
              {actions && (
                <th scope="col" className="w-12 border-b border-border px-4 py-2.5">
                  <span className="sr-only">{t('actions')}</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: SKELETON_ROWS }, (_, index) => (
                  <tr key={index} className="border-b border-border last:border-b-0">
                    <td colSpan={allColumns} className="px-4 py-3">
                      <Skeleton className="h-5 w-full" />
                    </td>
                  </tr>
                ))
              : rows.map((row, index) => (
                  <tr
                    key={rowKey(row)}
                    className="border-b border-border transition-colors last:border-b-0 hover:bg-muted/50"
                  >
                    <td className="px-4 py-3 align-middle text-muted-foreground tabular-nums">
                      {numberOf(index)}
                    </td>
                    {columns.map((column) => (
                      <td
                        key={column.id}
                        className={`px-4 py-3 align-middle ${ALIGN[column.align ?? 'start']} ${column.className ?? ''}`}
                      >
                        {column.cell(row)}
                      </td>
                    ))}
                    {actions && (
                      <td className="px-2 py-2 text-right align-middle">{actions(row)}</td>
                    )}
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
      {mobileCard && (
        <ol className="flex flex-col gap-3 md:hidden" aria-label={caption}>
          {(loading ? [] : rows).map((row, index) => (
            <li key={rowKey(row)}>
              <div className="mb-1 flex min-h-8 items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground tabular-nums">
                  {t('number')} {numberOf(index)}
                </span>
                {actions?.(row)}
              </div>
              {mobileCard(row)}
            </li>
          ))}
          {loading && <Skeleton className="h-28 w-full" />}
        </ol>
      )}
      {pagination && pagination.total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <PageSizeSelect
              pageSize={pagination.pageSize}
              disabled={pagination.pending}
              onChange={pagination.onPageSizeChange}
            />
            <p className="text-sm whitespace-nowrap text-muted-foreground tabular-nums">
              {t('summary', {
                from: formatNumber(offset + 1),
                to: formatNumber(Math.min(offset + pagination.pageSize, pagination.total)),
                total: formatNumber(pagination.total),
              })}
            </p>
          </div>
          <Pagination
            page={pagination.page}
            pageSize={pagination.pageSize}
            total={pagination.total}
            pending={pagination.pending}
            onPageChange={pagination.onPageChange}
          />
        </div>
      )}
    </div>
  );
}
