import type { GuestOrderTrackingView } from '@robux/shared';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Card } from '@/components/ui/Card';
import { PriceBreakdown } from '@/features/pricing/components/PriceBreakdown';
import { formatDateTime, formatNumber } from '@/lib/format/format';
import { OrderStageBadge } from './OrderStageBadge';

/** Public order view used by guest tracking and the customer account. Shows only API-provided values. */
export async function OrderDetails({
  order,
  actions,
  handoff,
}: {
  order: GuestOrderTrackingView;
  /** Rendered only while the API reports the order as cancellable. */
  actions?: ReactNode;
  handoff?: ReactNode;
}) {
  const t = await getTranslations('order');
  const stageLabel = await getTranslations('order.stage');
  return (
    <Card className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">{t('number')}</p>
          <p className="font-mono text-lg font-semibold">{order.orderNumber}</p>
        </div>
        <OrderStageBadge stage={order.stage} />
      </div>

      <dl className="grid gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-sm text-muted-foreground">{t('recipient')}</dt>
          <dd className="font-medium">{order.recipientUsername}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">{t('createdAt')}</dt>
          <dd className="font-medium">{formatDateTime(order.createdAt)}</dd>
        </div>
        {order.stage === 'AWAITING_PAYMENT' && order.paymentExpiresAt && (
          <div>
            <dt className="text-sm text-muted-foreground">{t('payBefore')}</dt>
            <dd className="font-medium">{formatDateTime(order.paymentExpiresAt)}</dd>
          </div>
        )}
      </dl>

      <div>
        <h2 className="mb-2 text-sm font-semibold">{t('payment')}</h2>
        <PriceBreakdown pricing={order.pricing} />
      </div>

      <div>
        <h2 className="text-sm font-semibold">{t('items')}</h2>
        <ul className="mt-2 divide-y divide-border">
          {order.items.map((item, index) => (
            <li key={index} className="flex justify-between gap-4 py-2 text-sm">
              <span>
                {item.productName} × {item.quantity}
              </span>
              <span className="text-muted-foreground">
                {t('robux', { amount: formatNumber(item.robuxAmount * item.quantity) })}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h2 className="text-sm font-semibold">{t('timeline')}</h2>
        <ol className="mt-2 flex flex-col gap-2">
          {order.timeline.map((entry) => (
            <li key={`${entry.stage}-${entry.at}`} className="flex justify-between gap-4 text-sm">
              <span>{stageLabel(entry.stage)}</span>
              <span className="text-muted-foreground">{formatDateTime(entry.at)}</span>
            </li>
          ))}
        </ol>
      </div>

      {order.cancellable && actions}
      {handoff}
    </Card>
  );
}
