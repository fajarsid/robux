'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { DropdownMenu } from '@/components/ui/DropdownMenu';
import { IconButton } from '@/components/ui/IconButton';
import type { IconName } from '@/components/ui/Icon';
import { applyConsoleTheme, CONSOLE_THEMES, type ConsoleTheme } from '../theme';

const THEME_ICONS: Record<ConsoleTheme, IconName> = {
  light: 'themeLight',
  dark: 'themeDark',
  system: 'themeSystem',
};

/** Light / dark / system. Applies at once and is remembered for the next page load. */
export function ThemeSwitcher({ initialTheme }: { initialTheme: ConsoleTheme }) {
  const t = useTranslations('console.theme');
  const [theme, setTheme] = useState(initialTheme);

  function choose(next: ConsoleTheme) {
    setTheme(next);
    applyConsoleTheme(next);
  }

  return (
    <DropdownMenu
      label={t('label')}
      trigger={(props) => <IconButton icon={THEME_ICONS[theme]} label={t('label')} {...props} />}
      items={CONSOLE_THEMES.map((option) => ({
        label: t(option),
        icon: THEME_ICONS[option],
        selected: option === theme,
        onSelect: () => choose(option),
      }))}
    />
  );
}
