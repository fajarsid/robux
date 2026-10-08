import type { PaymentStatusView, PublicOrderStage } from '@robux/shared';
import { useTranslations } from 'next-intl';
import { formatDateTime } from '@/lib/format/format';
import { Panel } from '@/components/layout/Panel';
import { PaymentStatusBadge } from '@/features/payments/components/PaymentStatusBadge';

/**
 * Payment is shown separately from the order status. `paymentStatus` is null until the staff
 * order view carries payment data; the card then says so instead of inferring it from the order.
 */
export function OrderPaymentCard({
  paymentStatus,
  paymentExpiresAt,
  stage,
}: {
  paymentStatus: PaymentStatusView | null;
  paymentExpiresAt: string | null;
  stage: PublicOrderStage;
}) {
  const t = useTranslations('adminOrders.detail');
  const tOrders = useTranslations('adminOrders');
  return (
    <Panel title={t('paymentTitle')}>
      <dl className="flex flex-col gap-3 text-sm">
        <div className="flex items-center justify-between gap-4">
          <dt className="text-muted-foreground">{t('paymentStatus')}</dt>
          <dd>
            {paymentStatus ? (
              <PaymentStatusBadge status={paymentStatus} />
            ) : (
              <span className="text-muted-foreground">{tOrders('noPayment')}</span>
            )}
          </dd>
        </div>
        {stage === 'AWAITING_PAYMENT' && paymentExpiresAt && (
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{t('payBefore')}</dt>
            <dd className="font-medium">{formatDateTime(paymentExpiresAt)}</dd>
          </div>
        )}
      </dl>
      {!paymentStatus && (
        <p className="mt-3 text-xs text-muted-foreground">{t('paymentUnavailable')}</p>
      )}
    </Panel>
  );
}
