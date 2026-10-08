import type { AdminOrderView } from '@robux/shared';
import { useTranslations } from 'next-intl';
import { formatDateTime } from '@/lib/format/format';
import { Panel } from '@/components/layout/Panel';
import { OrderStatusBadge } from './OrderStatusBadge';

/** Every recorded status change, as stored; nothing is inferred for steps without history. */
export function OrderTimeline({
  history,
  cancelReason,
}: Pick<AdminOrderView, 'history' | 'cancelReason'>) {
  const t = useTranslations('adminOrders');
  const label = (namespace: 'actor' | 'cancelReason', value: string) =>
    t.has(`${namespace}.${value}`) ? t(`${namespace}.${value}`) : value;

  return (
    <Panel title={t('detail.timelineTitle')}>
      {cancelReason && (
        <p className="mb-4 text-sm">
          <span className="text-muted-foreground">{t('detail.cancelReason')}: </span>
          {label('cancelReason', cancelReason)}
        </p>
      )}
      {history.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('detail.timelineEmpty')}</p>
      ) : (
        <ol className="flex flex-col">
          {history.map((entry, index) => (
            <li
              key={`${entry.toStatus}-${entry.at}-${index}`}
              className="relative flex gap-4 pb-5 last:pb-0"
            >
              <span aria-hidden className="flex flex-col items-center">
                <span className="mt-2 size-2.5 shrink-0 rounded-full bg-primary" />
                {index < history.length - 1 && <span className="mt-1 w-px flex-1 bg-border" />}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <OrderStatusBadge status={entry.toStatus} />
                  <time dateTime={entry.at} className="text-muted-foreground">
                    {formatDateTime(entry.at)}
                  </time>
                </div>
                <p className="text-muted-foreground">
                  {t('detail.actor', { actor: label('actor', entry.actorType) })}
                </p>
                {entry.reason && <p className="break-words">{entry.reason}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
