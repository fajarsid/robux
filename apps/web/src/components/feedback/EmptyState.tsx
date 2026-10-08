import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/components/ui/Icon';

/** No data (or no match) with an optional next step; also used for "not available yet". */
export function EmptyState({
  title,
  description,
  action,
  icon = 'document',
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: IconName;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-panel border border-dashed border-border px-6 py-10 text-center">
      <span className="mb-1 grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
        <Icon name={icon} size="md" />
      </span>
      <p className="font-medium">{title}</p>
      {description && <p className="max-w-md text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
