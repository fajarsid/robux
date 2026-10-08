import type { Metadata } from 'next';
import { Poppins } from 'next/font/google';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/feedback/Toast';
import { CONSOLE_ROOT_ID, CONSOLE_THEME_COOKIE, parseConsoleTheme } from '@/features/console/theme';

// Self-hosted by next/font at build time; no request to Google from the browser.
const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-poppins',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'Console', template: '%s · Console' },
  robots: { index: false, follow: false, nocache: true },
  referrer: 'same-origin',
};

/**
 * Typeface, colour scheme and toast host for every console screen, signed in or not. The theme
 * comes from a cookie so the server renders the right colours on the first paint.
 */
export default async function ConsoleRootLayout({ children }: { children: ReactNode }) {
  const theme = parseConsoleTheme((await cookies()).get(CONSOLE_THEME_COOKIE)?.value);
  return (
    <div
      id={CONSOLE_ROOT_ID}
      data-theme={theme}
      className={`${poppins.variable} min-h-dvh bg-background font-console text-foreground`}
    >
      <ToastProvider>{children}</ToastProvider>
    </div>
  );
}
