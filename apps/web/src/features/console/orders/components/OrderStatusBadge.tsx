import { useTranslations } from 'next-intl';
import { StatusBadge, type StatusTone } from '@/components/data-display/StatusBadge';
import { isOrderStatus, type OrderStatus } from '../types/admin-orders';

const STATUS_TONES: Record<OrderStatus, StatusTone> = {
  CREATED: 'neutral',
  PAYMENT_PENDING: 'attention',
  PAID: 'progress',
  QUEUED: 'progress',
  PROCESSING: 'progress',
  FULFILLMENT_PENDING: 'progress',
  FULFILLED: 'success',
  FAILED: 'danger',
  RETRYING: 'attention',
  FAILED_PERMANENTLY: 'danger',
  PARTIALLY_FULFILLED: 'attention',
  RECONCILIATION_REQUIRED: 'attention',
  CANCELLED: 'neutral',
  REFUND_PENDING: 'attention',
  REFUNDED: 'neutral',
};

/** Internal order status for staff; customers see `OrderStageBadge` instead. */
export function OrderStatusBadge({ status }: { status: string }) {
  const t = useTranslations('adminOrders.status');
  if (!isOrderStatus(status)) {
    return <StatusBadge tone="neutral">{status}</StatusBadge>;
  }
  return <StatusBadge tone={STATUS_TONES[status]}>{t(status)}</StatusBadge>;
}
