import type { AdminPriceVersionView } from '@robux/shared';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithIntl } from '@/test/render-with-intl';
import { PriceHistoryTable } from './PriceHistoryTable';

const base: AdminPriceVersionView = {
  id: 'v2',
  version: 2,
  status: 'ACTIVE',
  sellingPrice: '75000.00',
  currency: 'IDR',
  effectiveFrom: '2026-10-05T03:00:00.000Z',
  createdAt: '2026-10-05T03:00:00.000Z',
};

describe('PriceHistoryTable', () => {
  it('lists versions with their status and no edit actions', () => {
    renderWithIntl(
      <PriceHistoryTable
        prices={[
          base,
          { ...base, id: 'v1', version: 1, status: 'SUPERSEDED', sellingPrice: '70000.00' },
        ]}
      />,
    );
    expect(screen.getByText('v2')).toBeTruthy();
    expect(screen.getByText('Berlaku')).toBeTruthy();
    expect(screen.getByText('Digantikan')).toBeTruthy();
    expect(screen.getByText(/Rp\s?70\.000/)).toBeTruthy();
    // Versions are immutable: the only controls are the table's paging controls.
    expect(screen.queryByRole('button', { name: /edit|ubah|hapus/i })).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Navigasi halaman' })).toBeTruthy();
  });

  it('shows cost and margin columns only when the API included them', () => {
    const { unmount } = renderWithIntl(<PriceHistoryTable prices={[base]} />);
    expect(screen.queryByText('Harga modal')).toBeNull();
    unmount();
    renderWithIntl(
      <PriceHistoryTable prices={[{ ...base, costPrice: '50000.00', margin: '25000.00' }]} />,
    );
    expect(screen.getByText('Harga modal')).toBeTruthy();
    expect(screen.getByText(/Rp\s?25\.000/)).toBeTruthy();
  });
});
