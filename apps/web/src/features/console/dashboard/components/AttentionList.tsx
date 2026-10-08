import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { StatusBadge, type StatusTone } from '@/components/data-display/StatusBadge';

export interface AttentionItem {
  id: string;
  title: string;
  description: string;
  status: { tone: StatusTone; label: string };
  href?: string;
}

/** What needs a staff decision now, most urgent first; unknown items say so explicitly. */
export function AttentionList({ items }: { items: AttentionItem[] }) {
  const t = useTranslations('console.dashboard');
  return (
    <ul className="flex flex-col divide-y divide-border">
      {items.map((item) => {
        const body = (
          <>
            <div className="min-w-0">
              <p className="text-sm font-medium">{item.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{item.description}</p>
            </div>
            <StatusBadge tone={item.status.tone}>{item.status.label}</StatusBadge>
          </>
        );
        return (
          <li key={item.id}>
            {item.href ? (
              <Link
                href={item.href}
                aria-label={t('openItem', { item: item.title })}
                className="-mx-2 flex items-center justify-between gap-4 rounded-panel px-2 py-3 hover:bg-surface-muted/50"
              >
                {body}
              </Link>
            ) : (
              <div className="flex items-center justify-between gap-4 py-3">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
