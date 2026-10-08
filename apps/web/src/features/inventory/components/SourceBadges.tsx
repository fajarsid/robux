import type { SourceHealthName, SourceStatusName } from '@robux/shared';
import { useTranslations } from 'next-intl';
import { StatusBadge, type StatusTone } from '@/components/data-display/StatusBadge';

const HEALTH_TONES: Record<SourceHealthName, StatusTone> = {
  HEALTHY: 'success',
  DEGRADED: 'attention',
  UNAVAILABLE: 'danger',
  UNKNOWN: 'neutral',
};

/** Kill switch state: only ACTIVE sources receive new allocations. */
export function SourceStatusBadge({ status }: { status: SourceStatusName }) {
  const t = useTranslations('adminInventory.status');
  return <StatusBadge tone={status === 'ACTIVE' ? 'success' : 'neutral'}>{t(status)}</StatusBadge>;
}

export function SourceHealthBadge({ health }: { health: SourceHealthName }) {
  const t = useTranslations('adminInventory.health');
  return <StatusBadge tone={HEALTH_TONES[health]}>{t(health)}</StatusBadge>;
}

export function LowBalanceBadge({ low }: { low: boolean }) {
  const t = useTranslations('adminInventory');
  return (
    <StatusBadge tone={low ? 'attention' : 'neutral'}>
      {low ? t('lowBalance') : t('normalBalance')}
    </StatusBadge>
  );
}
