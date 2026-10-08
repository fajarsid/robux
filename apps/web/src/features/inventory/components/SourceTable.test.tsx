import type { AdminSourceView } from '@robux/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/feedback/Toast';
import { renderWithIntl } from '@/test/render-with-intl';
import { inventoryService } from '../services/inventory.service';
import { CreateSourceDialog } from './CreateSourceDialog';
import { SourceTable } from './SourceTable';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
  usePathname: () => '/console/inventory',
}));
vi.mock('../services/inventory.service', () => ({
  inventoryService: { create: vi.fn(), update: vi.fn(), setActive: vi.fn(), adjust: vi.fn() },
}));

/** jsdom has no showModal(), so the dialog's content is queried while it is technically closed. */
const dialog = () => within(document.querySelector('dialog') as HTMLElement);

function source(overrides: Partial<AdminSourceView> = {}): AdminSourceView {
  return {
    id: 's1',
    name: 'Mock Source A',
    provider: 'mock',
    productLine: 'ROBLOX_ROBUX',
    status: 'ACTIVE',
    health: 'HEALTHY',
    availableBalance: '10000',
    reservedBalance: '1500',
    lowBalanceThreshold: '1000',
    lowBalance: false,
    lowBalanceSince: null,
    priority: 1,
    costPerUnit: '95.0000',
    consecutiveFailures: 0,
    lastHealthCheckAt: null,
    updatedAt: '2026-10-05T00:00:00.000Z',
    ...overrides,
  };
}

function renderTable(sources: AdminSourceView[]) {
  return renderWithIntl(
    <ToastProvider>
      <SourceTable sources={sources} />
    </ToastProvider>,
  );
}

describe('SourceTable', () => {
  beforeEach(() => {
    refresh.mockReset();
    for (const fn of Object.values(inventoryService)) {
      vi.mocked(fn).mockReset();
    }
  });

  it('shows the standard columns with balances, kill switch, health and low balance', () => {
    renderTable([
      source(),
      source({
        id: 's2',
        name: 'Mock Source B',
        status: 'DISABLED',
        health: 'UNAVAILABLE',
        lowBalance: true,
      }),
    ]);
    const table = screen.getByRole('table', { name: 'Inventori' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual([
      'No.',
      'Sumber',
      'Penyedia',
      'Jenis',
      'Tersedia',
      'Dicadangkan',
      'Status',
      'Kesehatan',
      'Prioritas',
      'Saldo rendah',
      'Tindakan',
    ]);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(within(rows[0]!).getByText(/10\.000/)).toBeTruthy();
    expect(within(rows[0]!).getByText(/1\.500/)).toBeTruthy();
    expect(within(rows[1]!).getByText('Nonaktif')).toBeTruthy();
    expect(within(rows[1]!).getByText('Tidak tersedia')).toBeTruthy();
    expect(within(rows[1]!).getAllByText('Saldo rendah').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Tampilkan')).toBeTruthy();
  });

  it('shows an empty state instead of an empty table', () => {
    renderTable([]);
    expect(screen.getByText('Belum ada sumber.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('deactivates only after confirmation (kill switch)', async () => {
    vi.mocked(inventoryService.setActive).mockResolvedValue(source({ status: 'DISABLED' }));
    renderTable([source()]);
    const table = screen.getByRole('table');
    fireEvent.click(within(table).getByRole('button', { name: 'Tindakan untuk Mock Source A' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Nonaktifkan' }));
    expect(inventoryService.setActive).not.toHaveBeenCalled();
    fireEvent.click(dialog().getByRole('button', { name: 'Nonaktifkan', hidden: true }));
    await waitFor(() => expect(inventoryService.setActive).toHaveBeenCalledWith('s1', false));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('adjusts the balance with a signed amount and a reason', async () => {
    vi.mocked(inventoryService.adjust).mockResolvedValue(source({ availableBalance: '9500' }));
    renderTable([source()]);
    fireEvent.click(
      within(screen.getByRole('table')).getByRole('button', {
        name: 'Tindakan untuk Mock Source A',
      }),
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sesuaikan saldo' }));
    fireEvent.change(dialog().getByLabelText('Perubahan (Robux)'), { target: { value: '-5x00' } });
    fireEvent.change(dialog().getByLabelText('Alasan'), { target: { value: ' Stock opname ' } });
    fireEvent.click(dialog().getByRole('button', { name: 'Sesuaikan saldo', hidden: true }));
    await waitFor(() =>
      expect(inventoryService.adjust).toHaveBeenCalledWith('s1', {
        delta: '-500',
        reason: 'Stock opname',
      }),
    );
  });

  it('edits with the shared fields; an empty cost is sent as not configured', async () => {
    vi.mocked(inventoryService.update).mockResolvedValue(source());
    renderTable([source()]);
    fireEvent.click(
      within(screen.getByRole('table')).getByRole('button', {
        name: 'Tindakan untuk Mock Source A',
      }),
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit sumber' }));
    expect((dialog().getByLabelText('Nama sumber') as HTMLInputElement).value).toBe(
      'Mock Source A',
    );
    fireEvent.change(dialog().getByLabelText('Biaya per Robux (Rp)'), { target: { value: '' } });
    fireEvent.change(dialog().getByLabelText('Prioritas'), { target: { value: '3' } });
    fireEvent.click(dialog().getByRole('button', { name: 'Simpan perubahan', hidden: true }));
    await waitFor(() =>
      expect(inventoryService.update).toHaveBeenCalledWith('s1', {
        name: 'Mock Source A',
        priority: 3,
        lowBalanceThreshold: '1000',
        costPerUnit: null,
      }),
    );
  });
});

describe('CreateSourceDialog', () => {
  it('creates a source with provider, opening balance and the shared fields', async () => {
    vi.mocked(inventoryService.create).mockResolvedValue(source({ status: 'DISABLED' }));
    renderWithIntl(
      <ToastProvider>
        <CreateSourceDialog />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Sumber baru' }));
    fireEvent.change(dialog().getByLabelText('Nama sumber'), { target: { value: 'Source D' } });
    fireEvent.change(dialog().getByLabelText('Saldo awal (Robux)'), {
      target: { value: '2.500' },
    });
    fireEvent.change(dialog().getByLabelText('Biaya per Robux (Rp)'), {
      target: { value: '95.5' },
    });
    fireEvent.click(dialog().getByRole('button', { name: 'Tambah sumber', hidden: true }));
    await waitFor(() =>
      expect(inventoryService.create).toHaveBeenCalledWith({
        name: 'Source D',
        provider: 'mock',
        productLine: 'ROBLOX_ROBUX',
        priority: 100,
        lowBalanceThreshold: '0',
        costPerUnit: '95.5',
        openingBalance: '2500',
      }),
    );
  });
});
