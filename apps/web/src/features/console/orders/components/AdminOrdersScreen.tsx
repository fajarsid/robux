import { useTranslations } from 'next-intl';
import { Breadcrumb } from '@/components/layout/Breadcrumb';
import { PageHeader } from '@/components/layout/PageHeader';
import { CONSOLE_ROUTES } from '../../routes';
import { toOrderListSearchParams } from '../order-list-query';
import type { OrderListResult } from '../services/admin-orders.server';
import type { AdminOrderListQuery } from '../types/admin-orders';
import { OrderFilters } from './OrderFilters';
import { OrderFiltersPanel } from './OrderFiltersPanel';
import { OrderListFrame } from './OrderListFrame';
import { OrderListResults } from './OrderListResults';
import { OrderStatusTabs } from './OrderStatusTabs';

/** Orders module: status tabs, filters and the server-paged list for one URL query. */
export function AdminOrdersScreen({
  query,
  result,
}: {
  query: AdminOrderListQuery;
  result: OrderListResult;
}) {
  const t = useTranslations('adminOrders');
  const tConsole = useTranslations('console');
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        breadcrumb={
          <Breadcrumb
            label={tConsole('breadcrumb')}
            items={[
              { label: tConsole('nav.dashboard'), href: CONSOLE_ROUTES.home },
              { label: t('title') },
            ]}
          />
        }
      />
      <OrderListFrame
        query={query}
        controls={
          <>
            <OrderStatusTabs />
            <OrderFiltersPanel>
              {/* Remount on every URL change so the fields always show the applied query. */}
              <OrderFilters key={toOrderListSearchParams(query).toString()} />
            </OrderFiltersPanel>
          </>
        }
      >
        <OrderListResults result={result} query={query} />
      </OrderListFrame>
    </>
  );
}
