import { useTranslations } from 'next-intl';
import { StatCard } from '@/components/data-display/StatCard';
import { EmptyState } from '@/components/feedback/EmptyState';
import { PageHeader } from '@/components/layout/PageHeader';
import { Panel } from '@/components/layout/Panel';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { formatNumber } from '@/lib/format/format';
import { OrderTable } from '../../orders/components/OrderTable';
import type { OrderListResult } from '../../orders/services/admin-orders.server';
import { CONSOLE_ROUTES } from '../../routes';
import type { CatalogHealth } from '../catalog-health';
import { type AttentionItem, AttentionList } from './AttentionList';

const HEADLINE_METRICS = ['revenue', 'orders', 'paidPayments', 'fulfillmentRate'] as const;

/**
 * Answers: what happened, what needs attention, what happened recently. Every number comes from
 * an API response; metrics the backend does not report yet are labelled as unavailable.
 */
export function DashboardScreen({
  staffName,
  twoFactorEnabled,
  catalog,
  recentOrders,
}: {
  staffName: string;
  twoFactorEnabled: boolean;
  catalog: CatalogHealth | null;
  recentOrders: OrderListResult;
}) {
  const t = useTranslations('console.dashboard');
  const unknown = { tone: 'neutral' as const, label: t('unknown') };

  const attention: AttentionItem[] = [
    ...(twoFactorEnabled
      ? []
      : [
          {
            id: 'two-factor',
            title: t('attention.twoFactor'),
            description: t('attention.twoFactorBody'),
            status: { tone: 'attention' as const, label: t('attention.recommended') },
            href: CONSOLE_ROUTES.security,
          },
        ]),
    ...(catalog && catalog.activeWithoutPrice > 0
      ? [
          {
            id: 'unpriced',
            title: t('attention.unpriced'),
            description: t('attention.unpricedBody'),
            status: {
              tone: 'danger' as const,
              label: formatNumber(catalog.activeWithoutPrice),
            },
            href: CONSOLE_ROUTES.pricing,
          },
        ]
      : []),
    {
      id: 'pending-payments',
      title: t('attention.pendingPayments'),
      description: t('attention.awaitingBackend'),
      status: unknown,
    },
    {
      id: 'reconciliation',
      title: t('attention.reconciliation'),
      description: t('attention.awaitingBackend'),
      status: unknown,
    },
    {
      id: 'fulfillment',
      title: t('attention.failedFulfillment'),
      description: t('attention.futurePhase'),
      status: unknown,
    },
  ];

  return (
    <>
      <PageHeader title={t('title')} description={t('greeting', { name: staffName })} />

      <section aria-labelledby="headline-metrics">
        <h2 id="headline-metrics" className="sr-only">
          {t('metricsTitle')}
        </h2>
        <div className="grid gap-px overflow-hidden rounded-panel border border-border bg-border sm:grid-cols-2 xl:grid-cols-4">
          {HEADLINE_METRICS.map((metric) => (
            <StatCard
              key={metric}
              label={t(`metrics.${metric}`)}
              value={null}
              unavailableText={t('metricUnavailable')}
            />
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t('metricsNote')}</p>
      </section>

      <div className="grid gap-6 xl:grid-cols-3">
        <Panel title={t('attentionTitle')} className="xl:col-span-2">
          <AttentionList items={attention} />
        </Panel>
        <Panel
          title={t('catalogTitle')}
          actions={
            <ButtonLink href={CONSOLE_ROUTES.products} variant="link" className="text-sm">
              {t('viewAll')}
            </ButtonLink>
          }
        >
          {catalog ? (
            <dl className="grid grid-cols-3 gap-4">
              {(['active', 'inactive', 'total'] as const).map((key) => (
                <div key={key}>
                  <dt className="text-xs text-muted-foreground">{t(`catalog.${key}`)}</dt>
                  <dd className="mt-1 text-xl font-semibold tabular-nums">
                    {formatNumber(catalog[key])}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">{t('catalogFailed')}</p>
          )}
        </Panel>
      </div>

      <Panel
        title={t('recentOrdersTitle')}
        actions={
          <ButtonLink href={CONSOLE_ROUTES.orders} variant="link" className="text-sm">
            {t('viewAll')}
          </ButtonLink>
        }
      >
        {recentOrders.kind === 'ok' && recentOrders.list.items.length > 0 ? (
          <OrderTable orders={recentOrders.list.items} />
        ) : (
          <EmptyState
            title={recentOrders.kind === 'ok' ? t('noOrders') : t('ordersUnavailableTitle')}
            description={recentOrders.kind === 'ok' ? undefined : t('ordersUnavailableBody')}
          />
        )}
      </Panel>
    </>
  );
}
