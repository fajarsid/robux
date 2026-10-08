import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithIntl } from '@/test/render-with-intl';
import { orderList } from '../../orders/testing/admin-order-fixtures';
import { DashboardScreen } from './DashboardScreen';

const catalog = { total: 5, active: 3, inactive: 2, activeWithoutPrice: 1 };

describe('DashboardScreen', () => {
  it('never shows invented numbers for metrics the backend does not report', () => {
    renderWithIntl(
      <DashboardScreen
        staffName="Ana"
        twoFactorEnabled
        catalog={catalog}
        recentOrders={{ kind: 'unavailable' }}
      />,
    );
    const metrics = screen.getByRole('region', { name: 'Ringkasan kinerja' });
    expect(within(metrics).getAllByText('Belum tersedia')).toHaveLength(4);
    expect(within(metrics).queryByText(/\d/)).toBeNull();
    expect(screen.getByText('Daftar pesanan belum tersedia')).toBeTruthy();
  });

  it('flags real issues: own 2FA off and active products without a price', () => {
    renderWithIntl(
      <DashboardScreen
        staffName="Ana"
        twoFactorEnabled={false}
        catalog={catalog}
        recentOrders={{ kind: 'ok', list: orderList() }}
      />,
    );
    expect(
      screen.getByRole('link', { name: 'Buka: Verifikasi dua langkah belum aktif' }),
    ).toHaveProperty('href', expect.stringContaining('/console/security'));
    expect(
      screen.getByRole('link', { name: 'Buka: Produk aktif tanpa harga berlaku' }),
    ).toHaveProperty('href', expect.stringContaining('/console/pricing'));
    expect(screen.getAllByText('RBX-20261005-00001').length).toBeGreaterThan(0);
  });
});
