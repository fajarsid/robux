'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { StatusBadge } from '@/components/data-display/StatusBadge';
import { Dialog } from '@/components/ui/Dialog';
import { IconButton } from '@/components/ui/IconButton';
import type { ConsoleEnvironment } from '../environment';
import type { ConsoleTheme } from '../theme';
import { ConsoleBrand } from './ConsoleBrand';
import { ConsoleNav } from './ConsoleNav';
import { ThemeSwitcher } from './ThemeSwitcher';
import { type ConsoleStaff, UserMenu } from './UserMenu';

/** Menu trigger (below the sidebar breakpoint), environment, theme and the user menu. */
export function ConsoleTopbar({
  staff,
  environment,
  theme,
}: {
  staff: ConsoleStaff;
  environment: ConsoleEnvironment;
  theme: ConsoleTheme;
}) {
  const t = useTranslations('console');
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 bg-background/85 px-4 backdrop-blur sm:px-6 lg:px-8">
      <div className="flex items-center gap-3">
        <IconButton
          icon="menu"
          label={t('topbar.openMenu')}
          variant="outline"
          size="sm"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(true)}
          className="md:hidden"
        />
        <StatusBadge tone={environment === 'production' ? 'progress' : 'neutral'}>
          {t(`environment.${environment}`)}
        </StatusBadge>
      </div>
      <div className="flex items-center gap-1">
        <ThemeSwitcher initialTheme={theme} />
        <UserMenu staff={staff} />
      </div>
      <Dialog
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={t('nav.label')}
        hideHeader
        placement="left"
      >
        <ConsoleBrand />
        <ConsoleNav onNavigate={() => setMenuOpen(false)} />
      </Dialog>
    </header>
  );
}
