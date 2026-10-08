import { useTranslations } from 'next-intl';
import { Alert } from '@/components/feedback/Alert';
import { EmptyState } from '@/components/feedback/EmptyState';
import { hasActiveFilters } from '../order-list-query';
import type { OrderListResult } from '../services/admin-orders.server';
import type { AdminOrderListQuery } from '../types/admin-orders';
import { OrderListTable } from './OrderListTable';

export function OrderListResults({
  result,
  query,
}: {
  result: OrderListResult;
  query: AdminOrderListQuery;
}) {
  const t = useTranslations('adminOrders');
  if (result.kind === 'unavailable') {
    return (
      <EmptyState icon="orders" title={t('unavailableTitle')} description={t('unavailable')} />
    );
  }
  if (result.kind === 'error') {
    return <Alert tone="error">{t('loadFailed')}</Alert>;
  }
  return (
    <OrderListTable
      list={result.list}
      empty={
        <EmptyState
          icon="orders"
          title={
            query.status && !query.q && !query.paymentStatus
              ? t('empty.status', { status: t(`status.${query.status}`) })
              : t('empty.title')
          }
          description={hasActiveFilters(query) ? t('empty.filtered') : t('empty.none')}
        />
      }
    />
  );
}
