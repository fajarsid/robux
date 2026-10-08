import type { AdminOrderView } from '@robux/shared';
import { useTranslations } from 'next-intl';
import { Panel } from '@/components/layout/Panel';

export function OrderCustomerCard({ order }: { order: AdminOrderView }) {
  const t = useTranslations('adminOrders');
  const tProducts = useTranslations('products');
  const rows: [string, string][] = [
    [t('detail.email'), order.customer.contactEmail],
    [t('detail.accountType'), order.customer.guest ? t('guest') : t('registered')],
    [
      t('detail.productLine'),
      `${tProducts(`productLine.${order.productLine}`)} · ${tProducts(`fulfillmentType.${order.fulfillmentType}`)}`,
    ],
    [t('detail.recipient'), order.recipientUsername ?? t('detail.recipientNone')],
    // The platform's own user id exists only for Roblox recipients (resolved later).
    ...(order.recipientType === 'ROBLOX_USER'
      ? [
          [t('detail.robloxUserId'), order.recipientRobloxUserId ?? t('detail.notVerified')] as [
            string,
            string,
          ],
        ]
      : []),
  ];
  return (
    <Panel title={t('detail.customerTitle')}>
      <dl className="flex flex-col gap-3 text-sm">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-4"
          >
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-medium break-all sm:text-right">{value}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}
