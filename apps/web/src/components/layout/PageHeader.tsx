import type { ReactNode } from 'react';

/** Title row of a console page: breadcrumb above, description below, actions on the right. */
export function PageHeader({
  title,
  description,
  breadcrumb,
  meta,
  actions,
}: {
  title: ReactNode;
  description?: string;
  breadcrumb?: ReactNode;
  /** Small status line under the title, e.g. badges and timestamps. */
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3">
      {breadcrumb}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1 className="text-2xl font-semibold tracking-tight break-words">{title}</h1>
          {description && <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>}
          {meta && (
            <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              {meta}
            </div>
          )}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </div>
    </header>
  );
}
