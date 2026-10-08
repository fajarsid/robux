/** Every paginated console table offers these sizes, starting at the first. */
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];
export const DEFAULT_PAGE_SIZE: PageSize = 10;

export function isPageSize(value: number): value is PageSize {
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(value);
}

export function lastPageOf(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/**
 * Page numbers to show, with `null` for a gap: always the first and last page and up to one
 * neighbour on each side of the current one, e.g. 1 … 4 5 6 … 12.
 */
export function pageWindow(page: number, lastPage: number): (number | null)[] {
  const pages = new Set([1, lastPage, page - 1, page, page + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= lastPage).sort((a, b) => a - b);
  const result: (number | null)[] = [];
  for (const p of sorted) {
    const previous = result[result.length - 1];
    if (typeof previous === 'number' && p - previous === 2) {
      result.push(p - 1);
    } else if (typeof previous === 'number' && p - previous > 2) {
      result.push(null);
    }
    result.push(p);
  }
  return result;
}
