import type { ProductAvailability } from '@robux/shared';
import { useTranslations } from 'next-intl';
import { StatusBadge } from '@/components/data-display/StatusBadge';

/** Customer availability (in stock / out of stock) or admin sales status (active / inactive). */
export function ProductStatusBadge(
  props: { availability: ProductAvailability } | { active: boolean },
) {
  const t = useTranslations('products');
  if ('availability' in props) {
    return (
      <StatusBadge tone={props.availability === 'AVAILABLE' ? 'success' : 'neutral'}>
        {t(`availability.${props.availability}`)}
      </StatusBadge>
    );
  }
  return (
    <StatusBadge tone={props.active ? 'success' : 'neutral'}>
      {t(props.active ? 'status.ACTIVE' : 'status.INACTIVE')}
    </StatusBadge>
  );
}
