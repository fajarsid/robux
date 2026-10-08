'use client';

import { useMemo, useState } from 'react';
import type { DataTablePagination } from './DataTable';
import { DEFAULT_PAGE_SIZE, lastPageOf } from './pagination-model';

/**
 * Paging for lists the API returns whole (products, price versions). Lists the API pages itself
 * (orders) keep page and size in the URL instead.
 */
export function useClientPagination<Row>(rows: Row[]): {
  pageRows: Row[];
  pagination: DataTablePagination;
} {
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [requestedPage, setPage] = useState(1);
  // A shrinking list (e.g. after a refresh) never leaves the view on an empty page.
  const page = Math.min(requestedPage, lastPageOf(rows.length, pageSize));
  const pageRows = useMemo(
    () => rows.slice((page - 1) * pageSize, page * pageSize),
    [rows, page, pageSize],
  );
  return {
    pageRows,
    pagination: {
      page,
      pageSize,
      total: rows.length,
      onPageChange: setPage,
      onPageSizeChange: (size) => {
        setPageSize(size);
        setPage(1);
      },
    },
  };
}
