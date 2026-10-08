import type { CatalogProductView } from '@robux/shared';
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithIntl } from '@/test/render-with-intl';
import { pricingService } from '@/features/pricing/services/pricing.service';
import { ProductCard } from './ProductCard';

vi.mock('@/features/pricing/services/pricing.service', () => ({
  pricingService: { quote: vi.fn() },
}));

const product: CatalogProductView = {
  id: 'p1',
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

describe('ProductCard', () => {
  beforeEach(() => {
    vi.mocked(pricingService.quote).mockReset();
  });

  it('shows the product, its backend price and availability', async () => {
    vi.mocked(pricingService.quote).mockResolvedValue({
      productSlug: 'robux-500',
      quantity: 1,
      currency: 'IDR',
      unitPrice: '69000.00',
      subtotal: '69000.00',
      discount: '0.00',
      fee: '0.00',
      tax: '0.00',
      priceVersionId: 'v1',
      total: '69000.00',
      totalRobux: 500,
    });
    renderWithIntl(<ProductCard product={product} />);
    expect(screen.getByText('500 Robux')).toBeTruthy();
    expect(screen.getByText('Instan')).toBeTruthy();
    expect(screen.getByText('Tersedia')).toBeTruthy();
    expect(screen.getAllByText(/Rp\s?69\.000/).length).toBeGreaterThan(0);
  });

  it('displays the total exactly as quoted by the API (it never multiplies prices itself)', async () => {
    vi.mocked(pricingService.quote).mockResolvedValue({
      productSlug: 'robux-500',
      quantity: 1,
      currency: 'IDR',
      unitPrice: '69000.00',
      subtotal: '12345.00',
      discount: '0.00',
      fee: '0.00',
      tax: '0.00',
      priceVersionId: 'v1',
      total: '12345.00',
      totalRobux: 777,
    });
    renderWithIntl(<ProductCard product={product} />);
    expect(await screen.findByText(/Rp\s?12\.345/, {}, { timeout: 2000 })).toBeTruthy();
    expect(screen.getByText('Kamu menerima 777 Robux')).toBeTruthy();
    expect(pricingService.quote).toHaveBeenCalledWith('robux-500', 1);
  });

  it('disables quantity changes for out-of-stock products', () => {
    vi.mocked(pricingService.quote).mockReturnValue(new Promise(() => undefined));
    renderWithIntl(<ProductCard product={{ ...product, availability: 'OUT_OF_STOCK' }} />);
    expect(screen.getByText('Stok habis')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tambah jumlah' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Beli Sekarang' })).toHaveProperty('disabled', true);
  });

  it('links to checkout with the chosen product and quantity', () => {
    vi.mocked(pricingService.quote).mockReturnValue(new Promise(() => undefined));
    renderWithIntl(<ProductCard product={product} />);
    expect(screen.getByRole('link', { name: 'Beli Sekarang' }).getAttribute('href')).toBe(
      '/checkout?product=robux-500&quantity=1',
    );
  });
});
