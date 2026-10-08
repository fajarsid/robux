import type { AdminOrderView } from '@robux/shared';
import { useTranslations } from 'next-intl';
import { Breadcrumb } from '@/components/layout/Breadcrumb';
import { PageHeader } from '@/components/layout/PageHeader';
import { Panel } from '@/components/layout/Panel';
import { CopyButton } from '@/components/ui/CopyButton';
import { PriceBreakdown } from '@/features/pricing/components/PriceBreakdown';
import { formatDateTime } from '@/lib/format/format';
import { CONSOLE_ROUTES } from '../../routes';
import { isAwaitingPayment } from '../admin-order-permissions';
import { CancelOrderAction } from './CancelOrderAction';
import { OrderCustomerCard } from './OrderCustomerCard';
import { OrderItemsCard } from './OrderItemsCard';
import { OrderPaymentCard } from './OrderPaymentCard';
import { OrderStatusBadge } from './OrderStatusBadge';
import { OrderTimeline } from './OrderTimeline';
import { RefreshOrderButton } from './RefreshOrderButton';

/** Staff order detail. Every value comes from the API's order snapshot. */
export function AdminOrderDetail({
  order,
  mayCancel,
}: {
  order: AdminOrderView;
  /** Whether the viewer's role holds `orders.cancel`; the API checks it again. */
  mayCancel: boolean;
}) {
  const t = useTranslations('adminOrders');
  const tConsole = useTranslations('console');
  const cancellable = mayCancel && isAwaitingPayment(order);
  return (
    <>
      <PageHeader
        breadcrumb={
          <Breadcrumb
            label={tConsole('breadcrumb')}
            items={[
              { label: tConsole('nav.dashboard'), href: CONSOLE_ROUTES.home },
              { label: t('title'), href: CONSOLE_ROUTES.orders },
              { label: order.orderNumber },
            ]}
          />
        }
        title={<span className="font-mono">{order.orderNumber}</span>}
        meta={
          <>
            <OrderStatusBadge status={order.status} />
            <span>{t('detail.createdAt', { date: formatDateTime(order.createdAt) })}</span>
          </>
        }
        actions={
          <>
            <CopyButton
              value={order.orderNumber}
              label={t('copy.label')}
              copyText={t('copy.action')}
              copiedText={t('copy.copied')}
              failedText={t('copy.failed')}
              size="md"
            />
            <RefreshOrderButton />
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <OrderItemsCard items={order.items} currency={order.pricing.currency} />
          <OrderTimeline history={order.history} cancelReason={order.cancelReason} />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <Panel title={t('detail.actionsTitle')}>
            {mayCancel ? (
              <CancelOrderAction
                orderId={order.id}
                orderNumber={order.orderNumber}
                cancellable={cancellable}
              />
            ) : null}
            {!cancellable && (
              <p className="text-sm text-muted-foreground">{t('detail.noActions')}</p>
            )}
          </Panel>
          <OrderCustomerCard order={order} />
          {/* AdminOrderView has no payment data yet, so the card reports it as unavailable. */}
          <OrderPaymentCard
            paymentStatus={null}
            paymentExpiresAt={order.paymentExpiresAt}
            stage={order.stage}
          />
          <Panel title={t('detail.pricingTitle')}>
            <PriceBreakdown pricing={order.pricing} />
          </Panel>
        </div>
      </div>
    </>
  );
}
