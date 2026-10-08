import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { renderWithIntl } from '@/test/render-with-intl';
import { paymentsService } from '../services/payments.service';
import { guestAccess, methods, order, payment, paymentState } from '../testing/payment-fixtures';
import { OrderPaymentScreen } from './OrderPaymentScreen';

vi.mock('../services/payments.service', () => ({
  paymentsService: { state: vi.fn(), methods: vi.fn(), create: vi.fn() },
}));

const state = vi.mocked(paymentsService.state);
const listMethods = vi.mocked(paymentsService.methods);
const create = vi.mocked(paymentsService.create);

function renderScreen() {
  return renderWithIntl(<OrderPaymentScreen order={order} access={guestAccess} />);
}

describe('OrderPaymentScreen', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse('2026-10-05T07:00:00.000Z'));
    state.mockReset();
    listMethods.mockReset();
    create.mockReset();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('waiting for payment', () => {
    it('shows the API amount, deadline, countdown and the gateway page link', async () => {
      state.mockResolvedValue(paymentState());
      renderScreen();

      expect(await screen.findByText('Menunggu pembayaran', { selector: 'h2' })).toBeTruthy();
      expect(screen.getAllByText(/Rp\s?49\.000/).length).toBeGreaterThan(0);
      expect(screen.getByText('AA')).toBeTruthy();
      expect(screen.getByRole('timer').textContent).toBe('35:00');
      const link = screen.getByRole('link', { name: 'Lanjutkan ke halaman pembayaran' });
      expect(link.getAttribute('href')).toBe('https://pay.example.test/session/abc');
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
      expect(screen.getByText(/diperbarui otomatis/)).toBeTruthy();
      expect(screen.queryByText('Pembayaran berhasil')).toBeNull();
    });

    it('never links to a non-web gateway URL', async () => {
      state.mockResolvedValue(
        paymentState({ payment: payment({ paymentUrl: 'javascript:alert(1)' }) }),
      );
      renderScreen();
      await screen.findByText('Menunggu pembayaran', { selector: 'h2' });
      expect(screen.queryByRole('link', { name: 'Lanjutkan ke halaman pembayaran' })).toBeNull();
    });

    it('refreshes on demand and disables the button while checking', async () => {
      state.mockResolvedValueOnce(paymentState());
      let resolve: (value: ReturnType<typeof paymentState>) => void = () => undefined;
      state.mockReturnValueOnce(new Promise((r) => (resolve = r)));
      renderScreen();

      const refresh = await screen.findByRole('button', { name: 'Perbarui status' });
      fireEvent.click(refresh);
      const busy = await screen.findByRole('button', { name: 'Memeriksa…' });
      expect(busy).toHaveProperty('disabled', true);
      fireEvent.click(busy);
      expect(state).toHaveBeenCalledTimes(2);

      resolve(
        paymentState({ payment: payment({ status: 'PAID', paidAt: '2026-10-05T07:05:00.000Z' }) }),
      );
      expect(await screen.findByText('Pembayaran berhasil')).toBeTruthy();
    });

    it('copies the order number for support', async () => {
      state.mockResolvedValue(paymentState());
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      renderScreen();

      fireEvent.click(await screen.findByRole('button', { name: 'Salin Nomor pesanan' }));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(order.orderNumber));
      expect((await screen.findAllByText('Tersalin')).length).toBeGreaterThan(0);
    });
  });

  it('confirms a paid order without claiming the Robux were delivered', async () => {
    state.mockResolvedValue(
      paymentState({
        orderStage: 'PROCESSING',
        payment: payment({ status: 'PAID', paidAt: '2026-10-05T07:05:00.000Z', paymentUrl: null }),
      }),
    );
    renderScreen();

    expect(await screen.findByText('Pembayaran berhasil')).toBeTruthy();
    expect(screen.getByText(/Robux dikirim setelah pesanan diproses/)).toBeTruthy();
    expect(screen.queryByText(/Robux (sudah|telah) (dikirim|diterima)/)).toBeNull();
    expect(screen.getByRole('link', { name: 'Lihat pesanan' }).getAttribute('href')).toBe(
      `/order/${guestAccess.trackingToken}`,
    );
  });

  it.each([
    ['FAILED', 'Pembayaran gagal', 'Coba pembayaran lagi'],
    ['EXPIRED', 'Pembayaran kedaluwarsa', 'Buat pembayaran baru'],
    ['CANCELLED', 'Pembayaran dibatalkan', 'Buat pembayaran baru'],
  ] as const)('offers a new attempt after %s only when allowed', async (status, title, retry) => {
    state.mockResolvedValue(
      paymentState({ payment: payment({ status }), canCreatePayment: false }),
    );
    const first = renderScreen();
    expect(await screen.findByText(title)).toBeTruthy();
    expect(screen.queryByRole('button', { name: retry })).toBeNull();
    expect(screen.getByRole('link', { name: 'Lihat pesanan' })).toBeTruthy();
    first.unmount();

    state.mockResolvedValue(paymentState({ payment: payment({ status }), canCreatePayment: true }));
    listMethods.mockResolvedValue(methods);
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: retry }));
    expect(await screen.findByRole('radiogroup', { name: 'Metode pembayaran' })).toBeTruthy();
  });

  it('shows a cancelled order as closed with no way to pay', async () => {
    state.mockResolvedValue(
      paymentState({ orderStage: 'CANCELLED', payment: payment({ status: 'EXPIRED' }) }),
    );
    renderScreen();
    expect(await screen.findByText('Pesanan dibatalkan')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /pembayaran/i })).toBeNull();
  });

  it('stops at an access error and offers no retry', async () => {
    state.mockRejectedValue(new ApiError(404, 'ORDER_NOT_FOUND', ''));
    renderScreen();
    expect(await screen.findByText(/tidak memiliki akses ke pesanan ini/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Coba lagi' })).toBeNull();
  });

  it('sends a signed-out customer to the login page', async () => {
    state.mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', ''));
    renderScreen();
    expect((await screen.findByRole('link', { name: 'Masuk ke akun' })).getAttribute('href')).toBe(
      '/login',
    );
  });

  it('lets the customer retry a failed first load', async () => {
    state
      .mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', ''))
      .mockResolvedValue(paymentState());
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: 'Coba lagi' }));
    expect(await screen.findByText('Menunggu pembayaran', { selector: 'h2' })).toBeTruthy();
  });

  it('renders no credential or secret fields', async () => {
    state.mockResolvedValue(paymentState({ payment: null, canCreatePayment: true }));
    listMethods.mockResolvedValue(methods);
    const { container } = renderScreen();
    await screen.findByRole('radiogroup', { name: 'Metode pembayaran' });
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(container.textContent).not.toMatch(
      /password|kata sandi|cookie|api key|secret|signature/i,
    );
  });

  describe('starting a payment', () => {
    beforeEach(() => {
      state.mockResolvedValue(paymentState({ payment: null, canCreatePayment: true }));
      listMethods.mockResolvedValue(methods);
    });

    it('lists only the API methods and keeps unavailable ones unselectable', async () => {
      renderScreen();
      const group = await screen.findByRole('radiogroup', { name: 'Metode pembayaran' });
      const radios = within(group).getAllByRole('radio');
      expect(radios.map((radio) => radio.getAttribute('value'))).toEqual(['AA', 'BB', 'CC']);
      expect(within(group).getByRole('radio', { name: /BB/ })).toHaveProperty('disabled', true);
      expect(screen.getByRole('button', { name: 'Bayar sekarang' })).toHaveProperty(
        'disabled',
        true,
      );
    });

    it('creates one attempt per click burst and shows it as pending', async () => {
      let resolve: (value: ReturnType<typeof paymentState>) => void = () => undefined;
      create.mockReturnValue(new Promise((r) => (resolve = r)));
      renderScreen();

      fireEvent.click(await screen.findByRole('radio', { name: /CC/ }));
      const submit = screen.getByRole('button', { name: 'Bayar sekarang' });
      fireEvent.click(submit);
      fireEvent.click(submit);
      const busy = await screen.findByRole('button', { name: 'Membuat pembayaran…' });
      expect(busy).toHaveProperty('disabled', true);
      expect(create).toHaveBeenCalledTimes(1);
      expect(create.mock.calls[0]![1]).toEqual({ paymentMethod: 'CC' });

      resolve(paymentState({ payment: payment({ paymentMethod: 'CC' }) }));
      expect(await screen.findByText('Menunggu pembayaran', { selector: 'h2' })).toBeTruthy();
    });

    it('retries with the same idempotency key after a network failure', async () => {
      create
        .mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', ''))
        .mockResolvedValueOnce(paymentState());
      renderScreen();

      fireEvent.click(await screen.findByRole('radio', { name: /AA/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Bayar sekarang' }));
      expect(await screen.findByText(/Tidak dapat terhubung/)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Bayar sekarang' }));

      expect(await screen.findByText('Menunggu pembayaran', { selector: 'h2' })).toBeTruthy();
      const keys = create.mock.calls.map(([, , key]) => key);
      expect(keys).toHaveLength(2);
      expect(keys[1]).toBe(keys[0]);
      expect(keys[0]).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    });

    it('leads to the existing attempt when one is already pending', async () => {
      create.mockRejectedValue(new ApiError(409, 'PAYMENT_ALREADY_PENDING', ''));
      renderScreen();

      fireEvent.click(await screen.findByRole('radio', { name: /AA/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Bayar sekarang' }));
      expect(await screen.findByText(/sudah dibuat/)).toBeTruthy();

      state.mockResolvedValue(paymentState());
      fireEvent.click(screen.getByRole('button', { name: 'Perbarui status' }));
      expect(await screen.findByText('Menunggu pembayaran', { selector: 'h2' })).toBeTruthy();
    });

    it('explains when the API offers no methods', async () => {
      listMethods.mockResolvedValue([]);
      renderScreen();
      expect(await screen.findByText(/Belum ada metode pembayaran/)).toBeTruthy();
    });

    it('lets the customer reload the methods after an error', async () => {
      listMethods
        .mockRejectedValueOnce(new ApiError(503, 'PAYMENT_GATEWAY_UNAVAILABLE', ''))
        .mockResolvedValue(methods);
      renderScreen();
      expect(
        await screen.findByText(/Layanan pembayaran sedang tidak dapat dihubungi/),
      ).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Muat ulang metode' }));
      expect(await screen.findByRole('radiogroup', { name: 'Metode pembayaran' })).toBeTruthy();
    });
  });
});
