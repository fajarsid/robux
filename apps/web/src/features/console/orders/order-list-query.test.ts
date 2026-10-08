import { describe, expect, it } from 'vitest';
import { DEFAULT_PAGE_SIZE } from '@/components/data-display/pagination-model';
import {
  hasActiveFilters,
  parseOrderListQuery,
  toOrderListApiPath,
  toOrderListSearchParams,
} from './order-list-query';

describe('order list query', () => {
  it('reads every supported filter from the URL', () => {
    const query = parseOrderListQuery({
      q: '  RBX-20261005-00001 ',
      status: 'PAYMENT_PENDING',
      paymentStatus: 'PAID',
      createdFrom: '2026-10-01',
      createdTo: '2026-10-05',
      page: '3',
      pageSize: '50',
    });
    expect(query).toEqual({
      q: 'RBX-20261005-00001',
      status: 'PAYMENT_PENDING',
      paymentStatus: 'PAID',
      createdFrom: '2026-10-01',
      createdTo: '2026-10-05',
      page: 3,
      pageSize: 50,
    });
    expect(hasActiveFilters(query)).toBe(true);
  });

  it('drops unknown statuses, malformed dates and invalid paging instead of forwarding them', () => {
    const query = parseOrderListQuery({
      status: 'EXPIRED',
      paymentStatus: 'SETTLED',
      createdFrom: '05/10/2026',
      page: '-2',
      pageSize: '1000',
    });
    expect(query).toEqual({
      q: undefined,
      status: undefined,
      paymentStatus: undefined,
      createdFrom: undefined,
      createdTo: undefined,
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
    });
    expect(hasActiveFilters(query)).toBe(false);
  });

  it('uses the first value of a repeated parameter', () => {
    expect(parseOrderListQuery({ status: ['PAID', 'FULFILLED'] }).status).toBe('PAID');
  });

  it('keeps URLs short by omitting defaults, but always sends explicit paging to the API', () => {
    const query = parseOrderListQuery({ status: 'PAID' });
    expect(toOrderListSearchParams(query).toString()).toBe('status=PAID');
    expect(toOrderListApiPath(query)).toBe('/admin/orders?status=PAID&page=1&pageSize=10');
  });

  it('round-trips through the URL', () => {
    const query = parseOrderListQuery({ q: 'buyer@example.test', page: '2', pageSize: '100' });
    const again = parseOrderListQuery(Object.fromEntries(toOrderListSearchParams(query)));
    expect(again).toEqual(query);
  });
});
