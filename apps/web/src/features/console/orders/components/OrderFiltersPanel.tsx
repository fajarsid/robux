'use client';

import { useTranslations } from 'next-intl';
import { type ReactNode, useId, useState } from 'react';
import { Panel } from '@/components/layout/Panel';
import { Button } from '@/components/ui/Button';
import { useOrderListNavigation } from '../hooks/useOrderListNavigation';
import { hasActiveFilters } from '../order-list-query';

/**
 * Filters stay open from tablet width up. On phones they collapse behind a toggle so the results
 * are not pushed below the fold; the toggle says when filters are applied.
 */
export function OrderFiltersPanel({ children }: { children: ReactNode }) {
  const t = useTranslations('adminOrders.filters');
  const { query } = useOrderListNavigation();
  const [open, setOpen] = useState(false);
  const contentId = useId();
  return (
    <div className="flex flex-col gap-3">
      <Button
        variant="outline"
        size="md"
        icon="filter"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((value) => !value)}
        className="justify-between md:hidden"
      >
        <span className="flex-1 text-left">{t('label')}</span>
        <span className="text-xs text-muted-foreground">
          {hasActiveFilters(query) ? t('applied') : open ? t('hide') : t('show')}
        </span>
      </Button>
      <div id={contentId} className={`${open ? 'block' : 'hidden'} md:block`}>
        <Panel>{children}</Panel>
      </div>
    </div>
  );
}
