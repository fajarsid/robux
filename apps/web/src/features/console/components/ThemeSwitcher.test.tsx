import { fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithIntl } from '@/test/render-with-intl';
import { CONSOLE_ROOT_ID, parseConsoleTheme } from '../theme';
import { ThemeSwitcher } from './ThemeSwitcher';

function renderInConsoleRoot(initialTheme: 'light' | 'dark' | 'system') {
  return renderWithIntl(
    <div id={CONSOLE_ROOT_ID} data-theme={initialTheme}>
      <ThemeSwitcher initialTheme={initialTheme} />
    </div>,
  );
}

describe('ThemeSwitcher', () => {
  afterEach(() => {
    document.cookie = 'console-theme=; path=/; max-age=0';
  });

  it('marks the current theme in the menu', () => {
    renderInConsoleRoot('dark');
    fireEvent.click(screen.getByRole('button', { name: 'Tema tampilan' }));
    expect(screen.getByRole('menuitem', { name: 'Gelap' }).getAttribute('aria-current')).toBe(
      'true',
    );
    expect(
      screen.getByRole('menuitem', { name: 'Terang' }).getAttribute('aria-current'),
    ).toBeNull();
  });

  it('applies the chosen theme at once and remembers it in a cookie', () => {
    renderInConsoleRoot('dark');
    fireEvent.click(screen.getByRole('button', { name: 'Tema tampilan' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Terang' }));
    expect(document.getElementById(CONSOLE_ROOT_ID)?.getAttribute('data-theme')).toBe('light');
    expect(document.cookie).toContain('console-theme=light');

    fireEvent.click(screen.getByRole('button', { name: 'Tema tampilan' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Ikuti sistem' }));
    expect(document.getElementById(CONSOLE_ROOT_ID)?.getAttribute('data-theme')).toBe('system');
    expect(document.cookie).toContain('console-theme=system');
  });
});

describe('parseConsoleTheme', () => {
  it('accepts known themes and falls back to dark', () => {
    expect(parseConsoleTheme('light')).toBe('light');
    expect(parseConsoleTheme('system')).toBe('system');
    expect(parseConsoleTheme(undefined)).toBe('dark');
    expect(parseConsoleTheme('purple')).toBe('dark');
  });
});
