import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { renderWithIntl } from '@/test/render-with-intl';
import { adminOrdersService } from '../services/admin-orders.service';
import { adminOrder, ORDER_ID } from '../testing/admin-order-fixtures';
import { AdminOrderDetail } from './AdminOrderDetail';
import { ToastProvider } from '@/components/feedback/Toast';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
  usePathname: () => `/console/orders/${ORDER_ID}`,
}));
vi.mock('../services/admin-orders.service', () => ({
  adminOrdersService: { cancel: vi.fn() },
}));

const cancelButton = () => screen.queryByRole('button', { name: 'Batalkan pesanan' });

/** jsdom has no showModal(), so the dialog's content is queried while it is technically closed. */
const dialog = () => within(document.querySelector('dialog') as HTMLElement);

function openAndFillReason(reason: string) {
  fireEvent.click(cancelButton() as HTMLElement);
  fireEvent.change(dialog().getByLabelText('Alasan pembatalan'), { target: { value: reason } });
}

const confirmButton = () =>
  dialog().getByRole('button', { name: 'Batalkan pesanan', hidden: true });

describe('AdminOrderDetail', () => {
  beforeEach(() => {
    refresh.mockReset();
    vi.mocked(adminOrdersService.cancel).mockReset();
  });

  it('shows the order header, items, customer and the API pricing breakdown', () => {
    renderWithIntl(<AdminOrderDetail order={adminOrder()} mayCancel={false} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('RBX-20261005-00001');
    expect(screen.getByRole('button', { name: 'Salin nomor pesanan' })).toBeTruthy();
    expect(screen.getAllByText('Menunggu pembayaran').length).toBeGreaterThan(0);
    expect(screen.getByText('Robux 500 × 2')).toBeTruthy();
    expect(screen.getByText('500 Robux per paket')).toBeTruthy();
    expect(screen.getByText('guest@example.test')).toBeTruthy();
    expect(screen.getByText('Tamu')).toBeTruthy();
    expect(screen.getByText('Builder_Kid')).toBeTruthy();
    expect(screen.getByText('Belum diverifikasi')).toBeTruthy();
    expect(screen.getByText(/Rp\s?53\.000/)).toBeTruthy();
    expect(screen.getByText(/Rp\s?1\.000/)).toBeTruthy();
    expect(screen.getByText(/Rp\s?2\.000/)).toBeTruthy();
    expect(screen.getByText(/Rp\s?3\.000/)).toBeTruthy();
  });

  it('shows a digital-delivery order without a recipient or a Roblox user id', () => {
    renderWithIntl(
      <AdminOrderDetail
        order={adminOrder({
          productLine: 'TELEGRAM_ACCOUNT',
          platform: 'TELEGRAM',
          fulfillmentType: 'DIGITAL_DELIVERY',
          recipientType: null,
          unit: 'ACCOUNT',
          recipientUsername: null,
          recipientRobloxUserId: null,
        })}
        mayCancel={false}
      />,
    );
    expect(screen.getByText('Akun Telegram · Pengiriman digital dari stok')).toBeTruthy();
    expect(screen.getByText('Tidak ada, dikirim ke pesanan')).toBeTruthy();
    expect(screen.queryByText('ID pengguna Roblox')).toBeNull();
  });

  it('keeps payment status separate and does not infer it from the order status', () => {
    renderWithIntl(
      <AdminOrderDetail order={adminOrder({ status: 'PAID', stage: 'PROCESSING' })} mayCancel />,
    );
    expect(screen.getByText('Data pembayaran belum tersedia untuk pesanan ini.')).toBeTruthy();
    expect(screen.queryByText('Lunas')).toBeNull();
    expect(screen.queryByText('Batas pembayaran')).toBeNull();
  });

  it('lists the recorded status history with actor and reason', () => {
    renderWithIntl(
      <AdminOrderDetail
        order={adminOrder({
          status: 'CANCELLED',
          stage: 'CANCELLED',
          cancelReason: 'STAFF_ACTION',
          history: [
            ...adminOrder().history,
            {
              fromStatus: 'PAYMENT_PENDING',
              toStatus: 'CANCELLED',
              actorType: 'STAFF',
              reason: 'Duplicate order',
              at: '2026-10-05T03:10:00.000Z',
            },
          ],
        })}
        mayCancel
      />,
    );
    const timeline = screen.getByText('Riwayat status').closest('section') as HTMLElement;
    const entries = within(timeline).getAllByRole('listitem');
    expect(entries).toHaveLength(3);
    expect(within(entries[0]!).getByText('Dibuat')).toBeTruthy();
    expect(within(entries[0]!).getByText('Oleh Pelanggan')).toBeTruthy();
    expect(within(entries[2]!).getByText('Dibatalkan')).toBeTruthy();
    expect(within(entries[2]!).getByText('Oleh Staf')).toBeTruthy();
    expect(within(entries[2]!).getByText('Duplicate order')).toBeTruthy();
    expect(within(timeline).getByText('Dibatalkan oleh staf')).toBeTruthy();
    expect(cancelButton()).toBeNull();
  });

  it('never renders internal ids or credentials, even if the API sent them', () => {
    // Marker values only; each sensitive field name the API must never pass through.
    const sensitiveFields = [
      'trackingToken',
      'robloxPassword',
      'robloxCookie',
      'sessionToken',
      'totpSecret',
      'recoveryCodes',
      'duitkuApiKey',
      'duitkuSecret',
    ];
    const leaky = {
      ...adminOrder(),
      ...Object.fromEntries(sensitiveFields.map((field) => [field, `LEAK-MARKER-${field}`])),
    };
    const { container } = renderWithIntl(<AdminOrderDetail order={leaky} mayCancel />);
    const html = container.innerHTML;
    expect(html).not.toContain(ORDER_ID);
    for (const field of sensitiveFields) {
      expect(html).not.toContain(`LEAK-MARKER-${field}`);
    }
  });

  it('hides cancellation from roles without orders.cancel (OPERATOR)', () => {
    renderWithIntl(<AdminOrderDetail order={adminOrder()} mayCancel={false} />);
    expect(cancelButton()).toBeNull();
    expect(screen.getByText('Tidak ada tindakan yang tersedia untuk pesanan ini.')).toBeTruthy();
  });

  it('offers cancellation only while the order awaits payment', () => {
    const { unmount } = renderWithIntl(<AdminOrderDetail order={adminOrder()} mayCancel />);
    expect(cancelButton()).toBeTruthy();
    unmount();
    renderWithIntl(
      <AdminOrderDetail order={adminOrder({ status: 'PAID', stage: 'PROCESSING' })} mayCancel />,
    );
    expect(cancelButton()).toBeNull();
  });

  it('requires a reason before calling the API', () => {
    renderWithIntl(<AdminOrderDetail order={adminOrder()} mayCancel />);
    openAndFillReason('no');
    fireEvent.click(confirmButton());
    expect(adminOrdersService.cancel).not.toHaveBeenCalled();
    expect(dialog().getByText('Isi alasan 3–500 karakter.')).toBeTruthy();
    expect(dialog().getByText(/Pesanan RBX-20261005-00001 akan dibatalkan/)).toBeTruthy();
  });

  it('cancels with the reason, disables the dialog while submitting, then refreshes', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    vi.mocked(adminOrdersService.cancel).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }) as never,
    );
    // The console layout hosts toasts; success is confirmed there and survives the refresh.
    renderWithIntl(
      <ToastProvider>
        <AdminOrderDetail order={adminOrder()} mayCancel />
      </ToastProvider>,
    );
    openAndFillReason('  Customer asked by chat  ');
    fireEvent.click(confirmButton());

    expect(adminOrdersService.cancel).toHaveBeenCalledWith(ORDER_ID, 'Customer asked by chat');
    await waitFor(() => expect(confirmButton()).toHaveProperty('disabled', true));
    expect(dialog().getByRole('button', { name: 'Jangan batalkan', hidden: true })).toHaveProperty(
      'disabled',
      true,
    );
    expect(refresh).not.toHaveBeenCalled();

    resolve(adminOrder({ status: 'CANCELLED', stage: 'CANCELLED' }));
    expect(await screen.findByText('Pesanan berhasil dibatalkan.')).toBeTruthy();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('shows the backend refusal and reloads the real state when another admin acted first', async () => {
    vi.mocked(adminOrdersService.cancel).mockRejectedValue(
      new ApiError(409, 'ORDER_NOT_CANCELLABLE', 'already paid'),
    );
    renderWithIntl(<AdminOrderDetail order={adminOrder()} mayCancel />);
    openAndFillReason('Customer asked by chat');
    fireEvent.click(confirmButton());

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Pesanan ini tidak dapat dibatalkan lagi.',
    );
    expect(screen.queryByText('Pesanan berhasil dibatalkan.')).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('shows a permission refusal from the API even if the UI offered the action', async () => {
    vi.mocked(adminOrdersService.cancel).mockRejectedValue(
      new ApiError(403, 'FORBIDDEN', 'forbidden'),
    );
    renderWithIntl(<AdminOrderDetail order={adminOrder()} mayCancel />);
    openAndFillReason('Customer asked by chat');
    fireEvent.click(confirmButton());
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Kamu tidak memiliki akses ke halaman ini.',
    );
  });
});
