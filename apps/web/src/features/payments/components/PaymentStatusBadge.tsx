import type { PaymentStatusView } from '@robux/shared';
import { useTranslations } from 'next-intl';
import { StatusBadge, type StatusTone } from '@/components/data-display/StatusBadge';

const STATUS_TONES: Record<PaymentStatusView, StatusTone> = {
  PENDING: 'attention',
  PAID: 'success',
  FAILED: 'danger',
  EXPIRED: 'neutral',
  CANCELLED: 'neutral',
  REFUND_PENDING: 'attention',
  REFUNDED: 'neutral',
};

/** Payment attempt status, for customers and staff alike. */
export function PaymentStatusBadge({ status }: { status: PaymentStatusView }) {
  const t = useTranslations('payment.status');
  return <StatusBadge tone={STATUS_TONES[status]}>{t(status)}</StatusBadge>;
}
