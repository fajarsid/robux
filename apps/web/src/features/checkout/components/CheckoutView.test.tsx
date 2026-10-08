import type { CatalogProductView, OrderCreatedView, PriceQuoteView } from '@robux/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pricingService } from '@/features/pricing/services/pricing.service';
import { ApiError } from '@/lib/api/api-error';
import { renderWithIntl } from '@/test/render-with-intl';
import { checkoutService } from '../services/checkout.service';
import { CheckoutView } from './CheckoutView';

vi.mock('@/features/pricing/services/pricing.service', () => ({
  pricingService: { quote: vi.fn() },
}));
vi.mock('../services/checkout.service', () => ({
  checkoutService: { placeOrder: vi.fn() },
}));

const product: CatalogProductView = {
  id: '0192f0a0-0000-7000-8000-000000000001',
  slug: 'robux-500',
  name: 'Robux 500',
  robuxAmount: 500,
  fulfillmentMethod: 'INSTANT',
  productLine: 'ROBLOX_ROBUX',
  platform: 'ROBLOX',
  fulfillmentType: 'BALANCE_PURCHASE',
  recipientType: 'ROBLOX_USER',
  unit: 'ROBUX',
  minQuantity: 1,
  maxQuantity: 10,
  price: { amount: '69000.00', currency: 'IDR', versionId: 'v1' },
  availability: 'AVAILABLE',
};

function quote(overrides: Partial<PriceQuoteView> = {}): PriceQuoteView {
  return {
    productSlug: 'robux-500',
    priceVersionId: 'v1',
    quantity: 2,
    currency: 'IDR',
    unitPrice: '69000.00',
    subtotal: '138000.00',
    discount: '0.00',
    fee: '0.00',
    tax: '0.00',
    total: '138000.00',
    totalRobux: 1000,
    ...overrides,
  };
}

const created: OrderCreatedView = {
  orderNumber: 'RBX-20261005-00042',
  trackingToken: 'tok_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG',
  stage: 'AWAITING_PAYMENT',
  pricing: quote(),
  recipientUsername: 'Builder_Kid',
  paymentExpiresAt: '2026-10-05T13:00:00.000Z',
};

async function fillAndConfirm() {
  fireEvent.change(screen.getByLabelText('Username Roblox penerima'), {
    target: { value: ' Builder_Kid ' },
  });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'guest@example.test' } });
  const checkbox = await screen.findByRole('checkbox');
  await waitFor(() => expect(checkbox).toHaveProperty('disabled', false));
  fireEvent.click(checkbox);
}

describe('CheckoutView', () => {
  beforeEach(() => {
    vi.mocked(pricingService.quote).mockReset();
    vi.mocked(checkoutService.placeOrder).mockReset();
    sessionStorage.clear();
  });

  it('shows the full backend breakdown, exactly as quoted', async () => {
    vi.mocked(pricingService.quote).mockResolvedValue(
      quote({
        subtotal: '138000.00',
        discount: '1000.00',
        fee: '2000.00',
        tax: '3000.00',
        total: '777777.00',
      }),
    );
    renderWithIntl(
      <CheckoutView product={product} initialQuantity={2} buyer={{ kind: 'guest' }} />,
    );

    expect(await screen.findByText(/Rp\s?777\.777/, {}, { timeout: 2000 })).toBeTruthy();
    expect(screen.getByText(/Rp\s?138\.000/)).toBeTruthy();
    expect(screen.getByText(/Rp\s?1\.000/)).toBeTruthy();
    expect(screen.getByText(/Rp\s?2\.000/)).toBeTruthy();
    expect(screen.getByText(/Rp\s?3\.000/)).toBeTruthy();
    expect(screen.getByText('Pajak')).toBeTruthy();
    expect(screen.getByText('IDR')).toBeTruthy();
    expect(pricingService.quote).toHaveBeenCalledWith('robux-500', 2);
  });

  it('shows Telegram recipient input for Premium and never shows the Roblox input', async () => {
    vi.mocked(pricingService.quote).mockResolvedValue(quote());
    renderWithIntl(
      <CheckoutView
        product={{
          ...product,
          name: 'Telegram Premium',
          productLine: 'TELEGRAM_PREMIUM',
          platform: 'TELEGRAM',
          fulfillmentType: 'RECIPIENT_FULFILLMENT',
          recipientType: 'TELEGRAM_USER',
          unit: 'PREMIUM_MONTH',
        }}
        initialQuantity={1}
        buyer={{ kind: 'guest' }}
      />,
    );
    expect(await screen.findByLabelText('Username Telegram penerima')).toBeTruthy();
    expect(screen.queryByLabelText('Username Roblox penerima')).toBeNull();
  });

  it('does not ask for a recipient for digital delivery', async () => {
    vi.mocked(pricingService.quote).mockResolvedValue(quote());
    renderWithIntl(
      <CheckoutView
        product={{
          ...product,
          name: 'Telegram Account',
          productLine: 'TELEGRAM_ACCOUNT',
          platform: 'TELEGRAM',
          fulfillmentType: 'DIGITAL_DELIVERY',
          recipientType: null,
          unit: 'ACCOUNT',
        }}
        initialQuantity={1}
        buyer={{ kind: 'guest' }}
      />,
    );
    await screen.findByLabelText('Email');
    expect(screen.queryByLabelText('Username Telegram penerima')).toBeNull();
    expect(screen.queryByLabelText('Username Roblox penerima')).toBeNull();
  });

  it('places the order without any amount and shows an unpaid confirmation', async () => {
    vi.mocked(pricingService.quote).mockResolvedValue(quote());
    vi.mocked(checkoutService.placeOrder).mockResolvedValue(created);
    renderWithIntl(
      <CheckoutView product={product} initialQuantity={2} buyer={{ kind: 'guest' }} />,
    );

    const submit = screen.getByRole('button', { name: 'Buat pesanan' });
    expect(submit).toHaveProperty('disabled', true);
    await fillAndConfirm();
    fireEvent.click(submit);

    expect(await screen.findByText('RBX-20261005-00042')).toBeTruthy();
    expect(screen.getByText(/belum dibayar/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Lacak pesanan' }).getAttribute('href')).toBe(
      `/order/${created.trackingToken}`,
    );
    expect(screen.getByRole('link', { name: 'Bayar sekarang' }).getAttribute('href')).toBe(
      `/order/${created.trackingToken}/payment`,
    );
    expect(screen.queryByText(/Pembayaran berhasil|sudah dibayar/)).toBeNull();
    const [request, key] = vi.mocked(checkoutService.placeOrder).mock.calls[0]!;
    expect(request).toEqual({
      productId: product.id,
      quantity: 2,
      priceVersionId: 'v1',
      recipient: { robloxUsername: 'Builder_Kid' },
      contactEmail: 'guest@example.test',
    });
    expect(key).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
  });

  it('retries with the same idempotency key after a network failure', async () => {
    vi.mocked(pricingService.quote).mockResolvedValue(quote());
    vi.mocked(checkoutService.placeOrder)
      .mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', ''))
      .mockResolvedValueOnce(created);
    renderWithIntl(
      <CheckoutView product={product} initialQuantity={2} buyer={{ kind: 'guest' }} />,
    );

    await fillAndConfirm();
    fireEvent.click(screen.getByRole('button', { name: 'Buat pesanan' }));
    expect(await screen.findByText(/Tidak dapat terhubung/)).toBeTruthy();
    const checkbox = await screen.findByRole('checkbox');
    await waitFor(() => expect(checkbox).toHaveProperty('disabled', false));
    if (!(checkbox as HTMLInputElement).checked) {
      fireEvent.click(checkbox);
    }
    fireEvent.click(screen.getByRole('button', { name: 'Buat pesanan' }));

    expect(await screen.findByText('RBX-20261005-00042')).toBeTruthy();
    const keys = vi.mocked(checkoutService.placeOrder).mock.calls.map(([, key]) => key);
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
  });

  it('asks for a new confirmation when the price changed', async () => {
    vi.mocked(pricingService.quote)
      .mockResolvedValueOnce(quote())
      .mockResolvedValue(
        quote({
          priceVersionId: 'v2',
          unitPrice: '75000.00',
          subtotal: '150000.00',
          total: '150000.00',
        }),
      );
    vi.mocked(checkoutService.placeOrder).mockRejectedValueOnce(
      new ApiError(409, 'PRICE_CHANGED', ''),
    );
    renderWithIntl(
      <CheckoutView product={product} initialQuantity={2} buyer={{ kind: 'guest' }} />,
    );

    await fillAndConfirm();
    fireEvent.click(screen.getByRole('button', { name: 'Buat pesanan' }));

    expect(await screen.findByText(/Harga paket baru saja berubah/)).toBeTruthy();
    expect(
      (await screen.findAllByText(/Rp\s?150\.000/, {}, { timeout: 2000 })).length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole('checkbox')).toHaveProperty('checked', false);
    expect(screen.getByRole('button', { name: 'Buat pesanan' })).toHaveProperty('disabled', true);
  });

  it('uses the account email for signed-in customers', async () => {
    vi.mocked(pricingService.quote).mockResolvedValue(quote());
    renderWithIntl(
      <CheckoutView
        product={product}
        initialQuantity={2}
        buyer={{ kind: 'customer', email: 'ana@example.test' }}
      />,
    );
    expect(screen.getByText(/ana@example\.test/)).toBeTruthy();
    expect(screen.queryByLabelText('Email')).toBeNull();
  });

  it('does not let staff accounts order', async () => {
    vi.mocked(pricingService.quote).mockResolvedValue(quote());
    renderWithIntl(
      <CheckoutView product={product} initialQuantity={2} buyer={{ kind: 'staff' }} />,
    );
    expect(screen.getByText(/Akun staf tidak dapat membuat pesanan/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Buat pesanan' })).toHaveProperty('disabled', true);
  });

  it('keeps the quantity within the product limits', async () => {
    vi.mocked(pricingService.quote).mockResolvedValue(quote({ quantity: 10 }));
    renderWithIntl(
      <CheckoutView product={product} initialQuantity={999} buyer={{ kind: 'guest' }} />,
    );
    await waitFor(() => expect(pricingService.quote).toHaveBeenCalledWith('robux-500', 10));
  });
});
