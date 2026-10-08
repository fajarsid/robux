import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import {
  DataTable,
  type DataTableColumn,
  type DataTablePagination,
} from '@/components/data-display/DataTable';
import { PaymentStatusBadge } from '@/features/payments/components/PaymentStatusBadge';
import { PriceDisplay } from '@/features/pricing/components/PriceDisplay';
import { formatDateTime, formatNumber } from '@/lib/format/format';
import { CONSOLE_ROUTES } from '../../routes';
import type { AdminOrderSummaryView } from '../types/admin-orders';
import { OrderCustomerLabel } from './OrderCustomerLabel';
import { OrderStatusBadge } from './OrderStatusBadge';

function PaymentCell({ order }: { order: AdminOrderSummaryView }) {
  const t = useTranslations('adminOrders');
  return order.paymentStatus ? (
    <PaymentStatusBadge status={order.paymentStatus} />
  ) : (
    <span className="text-sm text-muted-foreground">{t('noPayment')}</span>
  );
}

/** Order list rows: a table from tablet width, one tappable card per order on phones. */
export function OrderTable({
  orders,
  pagination,
  empty,
}: {
  orders: AdminOrderSummaryView[];
  pagination?: DataTablePagination;
  empty?: ReactNode;
}) {
  const t = useTranslations('adminOrders');
  const tProducts = useTranslations('products');

  const columns: DataTableColumn<AdminOrderSummaryView>[] = [
    {
      id: 'order',
      header: t('columns.order'),
      className: 'whitespace-nowrap',
      cell: (order) => (
        <Link
          href={CONSOLE_ROUTES.order(order.id)}
          aria-label={t('openOrder', { orderNumber: order.orderNumber })}
          className="font-mono font-semibold text-foreground hover:text-primary"
        >
          {order.orderNumber}
        </Link>
      ),
    },
    {
      id: 'customer',
      header: t('columns.customer'),
      className: 'max-w-56',
      cell: (order) => <OrderCustomerLabel customer={order.customer} />,
    },
    {
      id: 'product',
      header: t('columns.product'),
      cell: (order) => (
        <>
          <p className="font-medium">{order.productName}</p>
          <p className="text-xs text-muted-foreground">
            × {order.quantity} ·{' '}
            {t('robux', { amount: formatNumber(order.robuxAmount * order.quantity) })} ·{' '}
            {tProducts(`method.${order.fulfillmentMethod}`)}
          </p>
        </>
      ),
    },
    {
      id: 'total',
      header: t('columns.total'),
      align: 'end',
      className: 'whitespace-nowrap',
      cell: (order) => <PriceDisplay amount={order.total} currency={order.currency} size="sm" />,
    },
    {
      id: 'payment',
      header: t('columns.payment'),
      cell: (order) => <PaymentCell order={order} />,
    },
    {
      id: 'status',
      header: t('columns.status'),
      cell: (order) => <OrderStatusBadge status={order.status} />,
    },
    {
      id: 'created',
      header: t('columns.created'),
      className: 'whitespace-nowrap text-muted-foreground',
      cell: (order) => formatDateTime(order.createdAt),
    },
  ];

  return (
    <DataTable
      caption={t('title')}
      columns={columns}
      rows={orders}
      rowKey={(order) => order.id}
      pagination={pagination}
      empty={empty}
      mobileCard={(order) => (
        <Link
          href={CONSOLE_ROUTES.order(order.id)}
          aria-label={t('openOrder', { orderNumber: order.orderNumber })}
          className="flex flex-col gap-3 rounded-panel border border-border bg-surface p-4 transition-colors hover:border-primary-border"
        >
          <div className="flex items-start justify-between gap-3">
            <span className="font-mono text-sm font-semibold">{order.orderNumber}</span>
            <OrderStatusBadge status={order.status} />
          </div>
          <OrderCustomerLabel customer={order.customer} />
          <div className="flex items-end justify-between gap-3 text-sm">
            <div>
              <p>
                {order.productName} × {order.quantity}
              </p>
              <p className="text-xs text-muted-foreground">
                {t('robux', { amount: formatNumber(order.robuxAmount * order.quantity) })}
              </p>
            </div>
            <PriceDisplay amount={order.total} currency={order.currency} />
          </div>
          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <PaymentCell order={order} />
            <span>{formatDateTime(order.createdAt)}</span>
          </div>
        </Link>
      )}
    />
  );
}
