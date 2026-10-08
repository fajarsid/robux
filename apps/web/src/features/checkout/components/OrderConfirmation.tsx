'use client';

import type { OrderCreatedView } from '@robux/shared';
import { useTranslations } from 'next-intl';
import { Alert } from '@/components/feedback/Alert';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Card } from '@/components/ui/Card';
import { PayOrderLink } from '@/features/payments/components/PayOrderLink';
import { orderHref } from '@/features/payments/payment-links';
import type { OrderAccess } from '@/features/payments/types/payment.types';
import { PriceBreakdown } from '@/features/pricing/components/PriceBreakdown';
import { formatDateTime } from '@/lib/format/format';

/**
 * Shown once after the order is created. The order waits for payment; nothing here suggests it
 * has been paid or delivered. Payment continues on the payment page.
 */
export function OrderConfirmation({ order }: { order: OrderCreatedView }) {
  const t = useTranslations('checkout.confirmation');
  const trackingPath = orderHref({ kind: 'guest', trackingToken: order.trackingToken });
  const access: OrderAccess = order.orderId
    ? { kind: 'customer', orderId: order.orderId }
    : { kind: 'guest', trackingToken: order.trackingToken };
  return (
    <Card className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-2 text-muted-foreground">{t('body')}</p>
      </div>
      <dl className="grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-sm text-muted-foreground">{t('orderNumber')}</dt>
          <dd className="font-mono text-lg font-semibold">{order.orderNumber}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">{t('recipient')}</dt>
          <dd className="font-medium">{order.recipientUsername}</dd>
        </div>
        {order.paymentExpiresAt && (
          <div className="sm:col-span-2">
            <dt className="text-sm text-muted-foreground">{t('payBefore')}</dt>
            <dd className="font-medium">{formatDateTime(order.paymentExpiresAt)}</dd>
          </div>
        )}
      </dl>
      <PriceBreakdown pricing={order.pricing} />
      <Alert tone="info">{t('payNotice')}</Alert>
      <Alert tone="info">{t('saveLink')}</Alert>
      <div className="flex flex-col gap-3 sm:flex-row">
        <PayOrderLink access={access} />
        <ButtonLink href={trackingPath} rel="noreferrer" variant="outline">
          {t('track')}
        </ButtonLink>
        {order.orderId && (
          <ButtonLink href={`/account/orders/${order.orderId}`} variant="outline">
            {t('viewInAccount')}
          </ButtonLink>
        )}
      </div>
    </Card>
  );
}
