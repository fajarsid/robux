'use client';

import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useMemo, useTransition } from 'react';
import { toOrderListSearchParams } from '../order-list-query';
import type { AdminOrderListQuery } from '../types/admin-orders';

export interface OrderListNavigation {
  query: AdminOrderListQuery;
  /** True while the server renders the list for a new query. */
  pending: boolean;
  /** Any filter change returns to page 1; only paging keeps the explicit page. */
  navigate: (patch: Partial<AdminOrderListQuery>) => void;
}

export const OrderListNavigationContext = createContext<OrderListNavigation | null>(null);

/**
 * The URL is the single source of list state: refresh, back/forward and shared links reproduce
 * the same view, and the server component re-fetches for each URL.
 */
export function useOrderListNavigationState(query: AdminOrderListQuery): OrderListNavigation {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  const navigate = useCallback(
    (patch: Partial<AdminOrderListQuery>) => {
      const next = { ...query, ...patch, page: patch.page ?? 1 };
      const search = toOrderListSearchParams(next).toString();
      startTransition(() => router.push(search ? `${pathname}?${search}` : pathname));
    },
    [query, pathname, router],
  );

  return useMemo(() => ({ query, pending, navigate }), [query, pending, navigate]);
}

export function useOrderListNavigation(): OrderListNavigation {
  const navigation = useContext(OrderListNavigationContext);
  if (!navigation) {
    throw new Error('useOrderListNavigation must be used inside OrderListFrame');
  }
  return navigation;
}
