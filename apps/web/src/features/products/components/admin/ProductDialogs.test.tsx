import type { AdminProductView } from '@robux/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/feedback/Toast';
import { renderWithIntl } from '@/test/render-with-intl';
import { productsService } from '../../services/products.service';
import { CreateProductDialog } from './CreateProductDialog';
import { EditProductDialog } from './EditProductDialog';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
  usePathname: () => '/console/products',
}));
vi.mock('../../services/products.service', () => ({
  productsService: { create: vi.fn(), update: vi.fn() },
}));

/** jsdom has no showModal(), so the dialog's content is queried while it is technically closed. */
const dialog = () => within(document.querySelector('dialog') as HTMLElement);
const field = (label: string) => dialog().getByLabelText(label);

function product(overrides: Partial<AdminProductView> = {}): AdminProductView {
  return {
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
    displayOrder: 0,
    isActive: true,
    hasOrders: false,
    currentPrice: null,
    latestVersion: 1,
    updatedAt: '2026-10-05T00:00:00.000Z',
    ...overrides,
  };
}

describe('product dialogs', () => {
  beforeEach(() => {
    refresh.mockReset();
    vi.mocked(productsService.create).mockReset();
    vi.mocked(productsService.update).mockReset();
  });

  it('creates a product from the dialog and refreshes the list', async () => {
    vi.mocked(productsService.create).mockResolvedValue({
      ...product({ isActive: false }),
      prices: [],
    });
    renderWithIntl(
      <ToastProvider>
        <CreateProductDialog />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Produk baru' }));
    fireEvent.change(field('Slug (URL)'), { target: { value: 'Robux-500' } });
    fireEvent.change(field('Nama produk'), { target: { value: 'Robux 500' } });
    fireEvent.change(field('Jumlah per paket'), { target: { value: '500' } });
    fireEvent.change(field('Harga jual (Rp)'), { target: { value: 'Rp 75.000' } });
    fireEvent.change(field('Harga modal (Rp)'), { target: { value: '70000' } });
    fireEvent.click(dialog().getByRole('button', { name: 'Buat produk', hidden: true }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(productsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'robux-500',
        name: 'Robux 500',
        robuxAmount: 500,
        productLine: 'ROBLOX_ROBUX',
        initialPrice: { sellingPrice: '75000', costPrice: '70000' },
      }),
    );
    expect(await screen.findByText('Produk dibuat (nonaktif).')).toBeTruthy();
  });

  it('creates a Telegram product: the line is chosen in the dialog and gamepass is not offered', async () => {
    vi.mocked(productsService.create).mockResolvedValue({
      ...product({ isActive: false, productLine: 'TELEGRAM_STARS' }),
      prices: [],
    });
    renderWithIntl(
      <ToastProvider>
        <CreateProductDialog />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Produk baru' }));
    fireEvent.change(field('Metode pengiriman'), { target: { value: 'GAMEPASS' } });
    fireEvent.change(field('Jenis produk'), { target: { value: 'TELEGRAM_STARS' } });
    const methods = [...(field('Metode pengiriman') as HTMLSelectElement).options].map(
      (o) => o.value,
    );
    expect(methods).toEqual(['INSTANT']);
    fireEvent.change(field('Slug (URL)'), { target: { value: 'tg-stars-100' } });
    fireEvent.change(field('Nama produk'), { target: { value: 'Telegram Stars 100' } });
    fireEvent.change(field('Jumlah per paket'), { target: { value: '100' } });
    fireEvent.change(field('Harga jual (Rp)'), { target: { value: '30000' } });
    fireEvent.change(field('Harga modal (Rp)'), { target: { value: '25000' } });
    fireEvent.click(dialog().getByRole('button', { name: 'Buat produk', hidden: true }));
    await waitFor(() =>
      expect(productsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          productLine: 'TELEGRAM_STARS',
          fulfillmentMethod: 'INSTANT',
          robuxAmount: 100,
        }),
      ),
    );
  });

  it('edits with the same fields, prefilled from the product', async () => {
    vi.mocked(productsService.update).mockResolvedValue({
      ...product({ name: 'Robux 500 Plus' }),
      prices: [],
    });
    const onClose = vi.fn();
    renderWithIntl(
      <ToastProvider>
        <EditProductDialog product={product()} onClose={onClose} />
      </ToastProvider>,
    );
    expect((field('Nama produk') as HTMLInputElement).value).toBe('Robux 500');
    fireEvent.change(field('Nama produk'), { target: { value: 'Robux 500 Plus' } });
    fireEvent.click(dialog().getByRole('button', { name: 'Simpan perubahan', hidden: true }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(productsService.update).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ name: 'Robux 500 Plus', robuxAmount: 500 }),
    );
    expect(refresh).toHaveBeenCalled();
  });

  it('sends only the unlocked fields once the product has orders', async () => {
    vi.mocked(productsService.update).mockResolvedValue({ ...product(), prices: [] });
    const onClose = vi.fn();
    renderWithIntl(
      <ToastProvider>
        <EditProductDialog product={product({ hasOrders: true })} onClose={onClose} />
      </ToastProvider>,
    );
    fireEvent.click(dialog().getByRole('button', { name: 'Simpan perubahan', hidden: true }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const changes = vi.mocked(productsService.update).mock.calls[0]![1];
    expect(Object.keys(changes).sort()).toEqual([
      'displayOrder',
      'maxQuantity',
      'minQuantity',
      'name',
    ]);
  });

  it('keeps the dialog open and shows the API error when saving fails', async () => {
    vi.mocked(productsService.update).mockRejectedValue(new Error('network'));
    const onClose = vi.fn();
    renderWithIntl(
      <ToastProvider>
        <EditProductDialog product={product()} onClose={onClose} />
      </ToastProvider>,
    );
    fireEvent.click(dialog().getByRole('button', { name: 'Simpan perubahan', hidden: true }));
    expect(await dialog().findByRole('alert', { hidden: true })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});
