import type { PublicOrderStage } from '@robux/shared';
import { useTranslations } from 'next-intl';
import { StatusBadge, type StatusTone } from '@/components/data-display/StatusBadge';

const STAGE_TONES: Record<PublicOrderStage, StatusTone> = {
  AWAITING_PAYMENT: 'attention',
  PROCESSING: 'progress',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
  REFUND_IN_PROGRESS: 'attention',
  REFUNDED: 'neutral',
};

export function OrderStageBadge({ stage }: { stage: PublicOrderStage }) {
  const t = useTranslations('order.stage');
  return <StatusBadge tone={STAGE_TONES[stage]}>{t(stage)}</StatusBadge>;
}
