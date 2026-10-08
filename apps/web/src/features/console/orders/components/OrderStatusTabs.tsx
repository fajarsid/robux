'use client';

import { useTranslations } from 'next-intl';
import { useOrderListNavigation } from '../hooks/useOrderListNavigation';
import type { OrderStatus } from '../types/admin-orders';

/** Shortcuts for the statuses staff check most; every status remains available in the filters. */
const QUICK_STATUSES: readonly OrderStatus[] = [
  'PAYMENT_PENDING',
  'PAID',
  'PROCESSING',
  'FULFILLED',
  'FAILED',
  'CANCELLED',
];

export function OrderStatusTabs() {
  const t = useTranslations('adminOrders');
  const { query, navigate } = useOrderListNavigation();
  const tabs: { status: OrderStatus | undefined; label: string }[] = [
    { status: undefined, label: t('tabs.all') },
    ...QUICK_STATUSES.map((status) => ({ status, label: t(`status.${status}`) })),
  ];
  return (
    <div
      className="relative overflow-x-auto border-b border-border"
      role="group"
      aria-label={t('tabs.label')}
    >
      <div className="flex w-max gap-1">
        {tabs.map(({ status, label }) => {
          const active = query.status === status;
          return (
            <button
              key={status ?? 'all'}
              type="button"
              aria-pressed={active}
              onClick={() => navigate({ status })}
              className={`-mb-px border-b-2 px-3 py-2.5 text-sm whitespace-nowrap transition-colors ${
                active
                  ? 'border-primary font-medium text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
