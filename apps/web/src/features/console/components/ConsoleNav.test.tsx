import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithIntl } from '@/test/render-with-intl';
import { ConsoleNav } from './ConsoleNav';

let pathname = '/console';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

describe('ConsoleNav', () => {
  it('lists only screens that exist, grouped by section', () => {
    renderWithIntl(<ConsoleNav />);
    const links = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
    expect(links).toEqual([
      '/console',
      '/console/orders',
      '/console/products',
      '/console/pricing',
      '/console/inventory',
      '/console/security',
    ]);
    expect(screen.getByText('Penjualan')).toBeTruthy();
  });

  it('marks the section of the current page, including its sub-pages', () => {
    pathname = '/console/orders/0192f0a0-0000-7000-8000-0000000000aa';
    renderWithIntl(<ConsoleNav />);
    expect(screen.getByRole('link', { name: 'Pesanan' }).getAttribute('aria-current')).toBe('page');
    // The dashboard matches its own URL only.
    expect(screen.getByRole('link', { name: 'Dashboard' }).getAttribute('aria-current')).toBeNull();
  });
});
