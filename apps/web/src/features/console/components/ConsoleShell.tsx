import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import type { ConsoleEnvironment } from '../environment';
import type { ConsoleTheme } from '../theme';
import { ConsoleBrand } from './ConsoleBrand';
import { ConsoleNav } from './ConsoleNav';
import { ConsoleTopbar } from './ConsoleTopbar';
import type { ConsoleStaff } from './UserMenu';

/**
 * Sidebar from tablet width up, drawer below it; pages render into the main column. The sidebar has
 * no divider: it shares the page background.
 */
export function ConsoleShell({
  staff,
  environment,
  theme,
  children,
}: {
  staff: ConsoleStaff;
  environment: ConsoleEnvironment;
  theme: ConsoleTheme;
  children: ReactNode;
}) {
  const t = useTranslations('console');
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[13rem_minmax(0,1fr)] lg:grid-cols-[15rem_minmax(0,1fr)]">
      <a
        href="#console-main"
        className="sr-only rounded-panel bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
      >
        {t('skipToContent')}
      </a>
      <aside className="sticky top-0 hidden h-dvh flex-col overflow-y-auto bg-background md:flex">
        <ConsoleBrand />
        <ConsoleNav />
      </aside>
      <div className="flex min-w-0 flex-col">
        <ConsoleTopbar staff={staff} environment={environment} theme={theme} />
        <main
          id="console-main"
          className="mx-auto flex w-full max-w-[88rem] flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
