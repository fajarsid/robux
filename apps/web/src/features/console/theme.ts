/** Console colour scheme preference; the storefront is always dark. */
export const CONSOLE_THEMES = ['light', 'dark', 'system'] as const;
export type ConsoleTheme = (typeof CONSOLE_THEMES)[number];

export const DEFAULT_CONSOLE_THEME: ConsoleTheme = 'dark';

/** Not a secret and not HttpOnly: read by the server to render without a flash, set by the switcher. */
export const CONSOLE_THEME_COOKIE = 'console-theme';

/** The element whose `data-theme` selects the token set (app/console/layout.tsx). */
export const CONSOLE_ROOT_ID = 'console-root';

export function parseConsoleTheme(value: string | undefined): ConsoleTheme {
  return (CONSOLE_THEMES as readonly string[]).includes(value ?? '')
    ? (value as ConsoleTheme)
    : DEFAULT_CONSOLE_THEME;
}

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** Applies a theme to the open console at once and remembers it for the next page load. */
export function applyConsoleTheme(theme: ConsoleTheme): void {
  document.getElementById(CONSOLE_ROOT_ID)?.setAttribute('data-theme', theme);
  document.cookie = `${CONSOLE_THEME_COOKIE}=${theme}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
}
