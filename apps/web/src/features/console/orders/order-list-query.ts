import { DEFAULT_PAGE_SIZE, isPageSize } from '@/components/data-display/pagination-model';
import { type AdminOrderListQuery, isOrderStatus, isPaymentStatus } from './types/admin-orders';

const SEARCH_MAX_LENGTH = 254;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

type RawParams = Record<string, string | string[] | undefined>;

function first(params: RawParams, key: string): string | undefined {
  const value = params[key];
  return (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
}

function positiveInt(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : undefined;
}

/**
 * URL → query. Unknown or malformed values are dropped rather than forwarded, so a hand-edited
 * URL degrades to a broader list instead of an error.
 */
export function parseOrderListQuery(params: RawParams): AdminOrderListQuery {
  const status = first(params, 'status');
  const paymentStatus = first(params, 'paymentStatus');
  const createdFrom = first(params, 'createdFrom');
  const createdTo = first(params, 'createdTo');
  const pageSize = positiveInt(first(params, 'pageSize'));
  return {
    q: first(params, 'q')?.slice(0, SEARCH_MAX_LENGTH),
    status: status && isOrderStatus(status) ? status : undefined,
    paymentStatus: paymentStatus && isPaymentStatus(paymentStatus) ? paymentStatus : undefined,
    createdFrom: createdFrom && ISO_DATE.test(createdFrom) ? createdFrom : undefined,
    createdTo: createdTo && ISO_DATE.test(createdTo) ? createdTo : undefined,
    page: positiveInt(first(params, 'page')) ?? 1,
    pageSize: pageSize !== undefined && isPageSize(pageSize) ? pageSize : DEFAULT_PAGE_SIZE,
  };
}

/** Query → URL parameters; defaults are omitted so shared links stay short. */
export function toOrderListSearchParams(query: AdminOrderListQuery): URLSearchParams {
  const params = new URLSearchParams();
  const optional = ['q', 'status', 'paymentStatus', 'createdFrom', 'createdTo'] as const;
  for (const key of optional) {
    const value = query[key];
    if (value) {
      params.set(key, value);
    }
  }
  if (query.page > 1) {
    params.set('page', String(query.page));
  }
  if (query.pageSize !== DEFAULT_PAGE_SIZE) {
    params.set('pageSize', String(query.pageSize));
  }
  return params;
}

/** The API always receives explicit paging, independent of the URL's defaults. */
export function toOrderListApiPath(query: AdminOrderListQuery): string {
  const params = toOrderListSearchParams(query);
  params.set('page', String(query.page));
  params.set('pageSize', String(query.pageSize));
  return `/admin/orders?${params.toString()}`;
}

export function hasActiveFilters(query: AdminOrderListQuery): boolean {
  return Boolean(
    query.q || query.status || query.paymentStatus || query.createdFrom || query.createdTo,
  );
}
