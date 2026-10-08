'use client';

import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import { lastPageOf, pageWindow } from './pagination-model';

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  pending?: boolean;
  onPageChange: (page: number) => void;
}

const PAGE_BUTTON =
  'inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-panel px-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40';

/** Previous / page numbers / next. The caller decides how a page change is fetched. */
export function Pagination({
  page,
  pageSize,
  total,
  pending = false,
  onPageChange,
}: PaginationProps) {
  const t = useTranslations('common.pagination');
  const lastPage = lastPageOf(total, pageSize);
  return (
    <nav aria-label={t('label')} className="flex items-center gap-1">
      <button
        type="button"
        className={`${PAGE_BUTTON} text-muted-foreground hover:bg-muted hover:text-foreground`}
        disabled={pending || page <= 1}
        onClick={() => onPageChange(page - 1)}
        aria-label={t('previous')}
      >
        <Icon name="chevronLeft" size="xs" />
        <span aria-hidden className="hidden sm:inline">
          {t('previous')}
        </span>
      </button>
      {pageWindow(page, lastPage).map((number, index) =>
        number === null ? (
          <span key={`gap-${index}`} aria-hidden className="px-1 text-muted-foreground">
            …
          </span>
        ) : (
          <button
            key={number}
            type="button"
            aria-current={number === page ? 'page' : undefined}
            aria-label={t('page', { page: number })}
            disabled={pending}
            onClick={() => number !== page && onPageChange(number)}
            className={`${PAGE_BUTTON} tabular-nums ${
              number === page
                ? 'bg-primary font-semibold text-primary-foreground'
                : 'text-foreground hover:bg-muted'
            }`}
          >
            {number}
          </button>
        ),
      )}
      <button
        type="button"
        className={`${PAGE_BUTTON} text-muted-foreground hover:bg-muted hover:text-foreground`}
        disabled={pending || page >= lastPage}
        onClick={() => onPageChange(page + 1)}
        aria-label={t('next')}
      >
        <span aria-hidden className="hidden sm:inline">
          {t('next')}
        </span>
        <Icon name="chevronRight" size="xs" />
      </button>
    </nav>
  );
}
