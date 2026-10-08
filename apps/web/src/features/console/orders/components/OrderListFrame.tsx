'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import {
  OrderListNavigationContext,
  useOrderListNavigationState,
} from '../hooks/useOrderListNavigation';
import type { AdminOrderListQuery } from '../types/admin-orders';

/** Shares URL navigation between the controls and dims the results while a new page loads. */
export function OrderListFrame({
  query,
  controls,
  children,
}: {
  query: AdminOrderListQuery;
  controls: ReactNode;
  children: ReactNode;
}) {
  const t = useTranslations('adminOrders');
  const navigation = useOrderListNavigationState(query);
  return (
    <OrderListNavigationContext.Provider value={navigation}>
      <div className="flex flex-col gap-4">{controls}</div>
      <p role="status" className="sr-only">
        {navigation.pending ? t('loading') : ''}
      </p>
      <div
        aria-busy={navigation.pending}
        className={`flex flex-col gap-4 transition-opacity ${navigation.pending ? 'opacity-50' : ''}`}
      >
        {children}
      </div>
    </OrderListNavigationContext.Provider>
  );
}
