import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { ConsoleShell } from '@/features/console/components/ConsoleShell';
import { consoleEnvironment } from '@/features/console/environment';
import { requireStaff } from '@/features/console/services/staff.server';
import { CONSOLE_THEME_COOKIE, parseConsoleTheme } from '@/features/console/theme';

/**
 * The staff check runs here, above every loading boundary of the console, so a visitor without a
 * staff session gets a real redirect before any placeholder streams. The API still authorizes
 * every request the pages make.
 */
export default async function ConsoleWorkspaceLayout({ children }: { children: ReactNode }) {
  const [staff, environment, cookieStore] = await Promise.all([
    requireStaff(),
    consoleEnvironment(),
    cookies(),
  ]);
  const theme = parseConsoleTheme(cookieStore.get(CONSOLE_THEME_COOKIE)?.value);
  return (
    <ConsoleShell staff={staff} environment={environment} theme={theme}>
      {children}
    </ConsoleShell>
  );
}
