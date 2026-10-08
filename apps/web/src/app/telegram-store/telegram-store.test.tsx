import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TelegramStore from './telegram-store';

describe('Telegram Account Mini App', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState({}, '', '/telegram-store');
  });

  it('authenticates from Telegram initData, loads Core catalog and opens checkout', async () => {
    Object.assign(window, {
      Telegram: {
        WebApp: {
          initData: 'signed-telegram-init-data',
          ready: vi.fn(),
          expand: vi.fn(),
          colorScheme: 'dark',
        },
      },
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      const data = path.endsWith('/catalog')
        ? [
            {
              id: 'product-1',
              slug: 'telegram-account',
              name: 'Telegram Account',
              minQuantity: 1,
              price: { amount: '150000', currency: 'IDR', versionId: 'price-1' },
              availability: 'AVAILABLE',
            },
          ]
        : path.endsWith('/payment-methods')
          ? { methods: [{ code: 'MK' }] }
          : [];
      return { ok: true, json: async () => data } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<TelegramStore />);
    await waitFor(() =>
      expect(
        document.querySelector('script[src="https://telegram.org/js/telegram-web-app.js"]'),
      ).toBeTruthy(),
    );
    fireEvent.load(
      document.querySelector('script[src="https://telegram.org/js/telegram-web-app.js"]')!,
    );

    expect(await screen.findByRole('heading', { name: 'Telegram Account' })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/telegram/miniapp/catalog',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'tma signed-telegram-init-data' }),
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'BELI SEKARANG' }));
    expect(screen.getByRole('heading', { name: 'Checkout' })).toBeTruthy();
    expect(screen.getAllByText(/Rp\s?150\.000/)).toHaveLength(2);
  });

  it('offers Stars only when the Core price snapshot has an explicit XTR quote', async () => {
    Object.assign(window, {
      Telegram: { WebApp: { initData: 'signed-init-data', ready: vi.fn(), expand: vi.fn() } },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input);
        const data = path.endsWith('/catalog')
          ? [
              {
                id: 'account-1',
                slug: 'telegram-account',
                name: 'Telegram Account',
                minQuantity: 1,
                price: { amount: '150000', currency: 'IDR', versionId: 'p1', starsAmount: 90 },
                availability: 'AVAILABLE',
              },
            ]
          : path.endsWith('/payment-methods')
            ? { methods: [{ code: 'SP' }, { code: 'TELEGRAM_STARS' }] }
            : [];
        return { ok: true, json: async () => data } as Response;
      }),
    );
    render(<TelegramStore />);
    const script = 'script[src="https://telegram.org/js/telegram-web-app.js"]';
    await waitFor(() => expect(document.querySelector(script)).toBeTruthy());
    fireEvent.load(document.querySelector(script)!);
    fireEvent.click(await screen.findByRole('button', { name: 'BELI SEKARANG' }));
    expect(screen.getByRole('radio', { name: /SP/ })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Telegram Stars/ })).toBeTruthy();
    expect(screen.getByText('90 XTR')).toBeTruthy();
  });

  it('opens an order from an authenticated bot notification deep link', async () => {
    window.history.replaceState({}, '', '/telegram-store?view=orders&order=TG-10001');
    Object.assign(window, {
      Telegram: { WebApp: { initData: 'signed-init-data', ready: vi.fn(), expand: vi.fn() } },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input);
        const data =
          path.endsWith('/catalog') || path.endsWith('/orders')
            ? []
            : path.endsWith('/orders/TG-10001')
              ? {
                  reference: 'TG-10001',
                  orderNumber: 'TG-10001',
                  product: 'Telegram Account',
                  status: 'FULFILLED',
                  amount: '150000.00',
                  currency: 'IDR',
                  createdAt: new Date().toISOString(),
                  handoffAvailable: true,
                }
              : { methods: [] };
        return { ok: true, json: async () => data } as Response;
      }),
    );
    render(<TelegramStore />);
    const script = 'script[src="https://telegram.org/js/telegram-web-app.js"]';
    await waitFor(() => expect(document.querySelector(script)).toBeTruthy());
    fireEvent.load(document.querySelector(script)!);
    expect(await screen.findByRole('heading', { name: 'Pesanan TG-10001' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Buka Account' })).toBeTruthy();
  });

  it('reuses the same payment idempotency key after a transient response failure', async () => {
    Object.assign(window, {
      Telegram: { WebApp: { initData: 'signed-init-data', ready: vi.fn(), expand: vi.fn() } },
    });
    let paymentRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith('/catalog')) {
        return {
          ok: true,
          json: async () => [
            {
              id: 'product-1',
              slug: 'telegram-account',
              name: 'Telegram Account',
              minQuantity: 1,
              price: { amount: '150000', currency: 'IDR', versionId: 'price-1' },
              availability: 'AVAILABLE',
            },
          ],
        } as Response;
      }
      if (path.endsWith('/payment-methods'))
        return { ok: true, json: async () => ({ methods: [{ code: 'MK' }] }) } as Response;
      if (path.endsWith('/orders') && init?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({
            reference: 'TG-10002',
            orderNumber: 'TG-10002',
            status: 'PAYMENT_PENDING',
            amount: '150000.00',
            currency: 'IDR',
            createdAt: new Date().toISOString(),
          }),
        } as Response;
      }
      if (path.endsWith('/TG-10002/payment') && init?.method === 'POST') {
        paymentRequests += 1;
        if (paymentRequests === 1)
          return { ok: false, json: async () => ({ message: 'temporary error' }) } as Response;
        return {
          ok: true,
          json: async () => ({
            payment: {
              status: 'PENDING',
              paymentMethod: 'MK',
              paymentUrl: null,
              paymentQrPayload: null,
              expiresAt: null,
            },
          }),
        } as Response;
      }
      return { ok: true, json: async () => [] } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<TelegramStore />);
    const script = 'script[src="https://telegram.org/js/telegram-web-app.js"]';
    await waitFor(() => expect(document.querySelector(script)).toBeTruthy());
    fireEvent.load(document.querySelector(script)!);
    fireEvent.click(await screen.findByRole('button', { name: 'BELI SEKARANG' }));
    fireEvent.change(screen.getByLabelText(/Email untuk bukti pesanan/), {
      target: { value: 'buyer@example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Buat Pesanan' }));
    const retry = await screen.findByRole('button', { name: 'Coba siapkan pembayaran lagi' });
    fireEvent.click(retry);
    await waitFor(() => expect(paymentRequests).toBe(2));
    const keys = fetchMock.mock.calls
      .filter(
        ([input, init]) => String(input).endsWith('/TG-10002/payment') && init?.method === 'POST',
      )
      .map(([, init]) => new Headers(init?.headers).get('Idempotency-Key'));
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(
      fetchMock.mock.calls.filter(
        ([input, init]) => String(input).endsWith('/orders') && init?.method === 'POST',
      ),
    ).toHaveLength(1);
  });
});
