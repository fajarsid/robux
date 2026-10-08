import type { OrderItemView } from '@robux/shared';
import { useTranslations } from 'next-intl';
import { PriceDisplay } from '@/features/pricing/components/PriceDisplay';
import { formatNumber } from '@/lib/format/format';
import { Panel } from '@/components/layout/Panel';

/** The order's stored item snapshot; current catalog data is never consulted here. */
export function OrderItemsCard({ items, currency }: { items: OrderItemView[]; currency: string }) {
  const t = useTranslations('adminOrders');
  return (
    <Panel title={t('detail.itemsTitle')}>
      <ul className="divide-y divide-border">
        {items.map((item, index) => (
          <li key={index} className="flex justify-between gap-4 py-3 text-sm first:pt-0 last:pb-0">
            <div>
              <p className="font-medium">
                {item.productName} × {item.quantity}
              </p>
              <p className="text-muted-foreground">
                {t('detail.perPackage', {
                  amount: formatNumber(item.robuxAmount),
                })}
              </p>
            </div>
            <PriceDisplay amount={item.lineSubtotal} currency={currency} size="sm" />
          </li>
        ))}
      </ul>
    </Panel>
  );
}
