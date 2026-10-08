import type { CustomerOrderSummaryView } from '@robux/shared';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { formatDateTime, formatMoney, formatNumber } from '@/lib/format/format';
import { OrderStageBadge } from '@/features/orders/components/OrderStageBadge';

export async function OrderHistoryList({ orders }: { orders: CustomerOrderSummaryView[] }) {
  const t = await getTranslations();
  if (orders.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('account.noOrders')}</p>;
  }
  return (
    <ul className="divide-y divide-border">
      {orders.map((order) => (
        <li key={order.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div>
            <p className="font-mono text-sm font-semibold">{order.orderNumber}</p>
            <p className="text-sm text-muted-foreground">
              {t('order.robux', { amount: formatNumber(order.totalRobux) })} ·{' '}
              {formatMoney(order.total, order.currency)} · {formatDateTime(order.createdAt)}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <OrderStageBadge stage={order.stage} />
            <Link
              href={`/account/orders/${order.id}`}
              className="text-sm text-primary hover:text-primary-hover"
            >
              {t('account.viewOrder')}
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}
