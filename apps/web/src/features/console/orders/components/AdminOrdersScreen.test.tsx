import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithIntl } from '@/test/render-with-intl';
import { parseOrderListQuery } from '../order-list-query';
import type { OrderListResult } from '../services/admin-orders.server';
import { orderList, orderSummary } from '../testing/admin-order-fixtures';
import { AdminOrdersScreen } from './AdminOrdersScreen';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  usePathname: () => '/console/orders',
}));

function renderScreen(
  params: Record<string, string> = {},
  result: OrderListResult = { kind: 'ok', list: orderList() },
) {
  return renderWithIntl(<AdminOrdersScreen query={parseOrderListQuery(params)} result={result} />);
}

describe('AdminOrdersScreen', () => {
  beforeEach(() => push.mockReset());

  it('lists orders with customer, product, API total and both statuses', () => {
    renderScreen(
      {},
      {
        kind: 'ok',
        list: orderList({
          items: [
            orderSummary(),
            orderSummary({
              id: 'b',
              orderNumber: 'RBX-20261005-00002',
              status: 'FULFILLED',
              paymentStatus: 'PAID',
              customer: { contactEmail: 'member@example.test', guest: false },
              total: '777777.00',
            }),
          ],
          total: 2,
        }),
      },
    );
    const table = screen.getByRole('table');
    expect(within(table).getByText('RBX-20261005-00001')).toBeTruthy();
    expect(within(table).getByText('guest@example.test')).toBeTruthy();
    expect(within(table).getByText('Tamu')).toBeTruthy();
    expect(within(table).getByText('Pelanggan terdaftar')).toBeTruthy();
    expect(within(table).getAllByText('Robux 500')).toHaveLength(2);
    expect(within(table).getByText(/Rp\s?777\.777/)).toBeTruthy();
    expect(within(table).getByText('Terkirim')).toBeTruthy();
    expect(within(table).getByText('Dibayar')).toBeTruthy();
    expect(within(table).getByText('Belum ada')).toBeTruthy();
    expect(
      within(table).getByRole('link', { name: 'Buka pesanan RBX-20261005-00002' }),
    ).toHaveProperty('href', expect.stringContaining('/console/orders/b'));
  });

  it('renders a card list for narrow screens next to the table for wider ones', () => {
    renderScreen();
    expect(screen.getByRole('table').closest('.md\\:block')?.className).toContain('hidden');
    const cards = screen.getByRole('list', { name: 'Pesanan' });
    expect(cards.className).toContain('md:hidden');
    expect(within(cards as HTMLElement).getByRole('link').textContent).toContain(
      'RBX-20261005-00001',
    );
    expect(within(cards as HTMLElement).queryByRole('table')).toBeNull();
  });

  it('applies search and filters through the URL, starting again at page 1', () => {
    renderScreen({ page: '4' });
    fireEvent.change(screen.getByLabelText('Cari'), { target: { value: ' RBX-20261005-00001 ' } });
    fireEvent.change(screen.getByLabelText('Status pesanan'), { target: { value: 'PAID' } });
    fireEvent.change(screen.getByLabelText('Status pembayaran'), { target: { value: 'PAID' } });
    fireEvent.change(screen.getByLabelText('Dari tanggal'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('Sampai tanggal'), { target: { value: '2026-10-05' } });
    fireEvent.click(screen.getByRole('button', { name: 'Terapkan' }));
    expect(push).toHaveBeenCalledWith(
      '/console/orders?q=RBX-20261005-00001&status=PAID&paymentStatus=PAID&createdFrom=2026-10-01&createdTo=2026-10-05',
    );
  });

  it('switches status with the quick tabs and clears filters', () => {
    renderScreen({ status: 'PAID', q: 'x@example.test' });
    expect(screen.getByRole('button', { name: 'Dibayar' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Menunggu pembayaran' }));
    expect(push).toHaveBeenLastCalledWith(
      '/console/orders?q=x%40example.test&status=PAYMENT_PENDING',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Hapus filter' }));
    expect(push).toHaveBeenLastCalledWith('/console/orders');
  });

  it('pages on the server: previous/next and page size change the URL only', () => {
    renderScreen(
      { page: '2' },
      { kind: 'ok', list: orderList({ page: 2, pageSize: 10, total: 45 }) },
    );
    expect(screen.getByText('11–20 dari 45')).toBeTruthy();
    // Row numbers continue across pages.
    expect(within(screen.getByRole('table')).getAllByRole('row')[1]!.textContent).toMatch(/^11/);
    expect(screen.getByRole('button', { name: 'Halaman 2' }).getAttribute('aria-current')).toBe(
      'page',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Berikutnya' }));
    expect(push).toHaveBeenLastCalledWith('/console/orders?page=3');
    fireEvent.click(screen.getByRole('button', { name: 'Sebelumnya' }));
    expect(push).toHaveBeenLastCalledWith('/console/orders');
    fireEvent.change(screen.getByLabelText('Tampilkan'), { target: { value: '50' } });
    expect(push).toHaveBeenLastCalledWith('/console/orders?pageSize=50');
  });

  it('disables paging past either end', () => {
    renderScreen({}, { kind: 'ok', list: orderList({ total: 5 }) });
    expect(screen.getByRole('button', { name: 'Sebelumnya' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Berikutnya' })).toHaveProperty('disabled', true);
  });

  it('shows a status-specific empty state', () => {
    renderScreen(
      { status: 'PAYMENT_PENDING' },
      { kind: 'ok', list: orderList({ items: [], total: 0 }) },
    );
    expect(screen.getByText('Tidak ada pesanan berstatus Menunggu pembayaran.')).toBeTruthy();
    expect(screen.getByText('Coba ubah filter atau kata kunci pencarian.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows a general empty state without filters', () => {
    renderScreen({}, { kind: 'ok', list: orderList({ items: [], total: 0 }) });
    expect(screen.getByText('Tidak ada pesanan.')).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Navigasi halaman' })).toBeNull();
  });

  it('reports a failed load and a missing list endpoint differently', () => {
    const { unmount } = renderScreen({}, { kind: 'error' });
    expect(screen.getByRole('alert').textContent).toContain('gagal dimuat');
    unmount();
    renderScreen({}, { kind: 'unavailable' });
    expect(screen.getByText('Daftar pesanan belum tersedia')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
