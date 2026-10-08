import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithIntl } from '@/test/render-with-intl';
import { ConfirmDialog } from './ConfirmDialog';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { IconButton } from './IconButton';

/** jsdom has no showModal(), so the dialog's content is queried while it is technically closed. */
const dialog = () => document.querySelector('dialog') as HTMLDialogElement;
const inDialog = () => within(dialog() as HTMLElement);

describe('Dialog', () => {
  it('is named by its title and described by its description', () => {
    renderWithIntl(
      <Dialog open onClose={vi.fn()} title="Edit produk" description="robux-500">
        Isi
      </Dialog>,
    );
    const labelledBy = dialog().getAttribute('aria-labelledby') as string;
    const describedBy = dialog().getAttribute('aria-describedby') as string;
    expect(document.getElementById(labelledBy)?.textContent).toBe('Edit produk');
    expect(document.getElementById(describedBy)?.textContent).toBe('robux-500');
  });

  it('closes from the close button and Escape, but not while busy', () => {
    const onClose = vi.fn();
    const { rerender } = renderWithIntl(
      <Dialog open onClose={onClose} title="Judul">
        Isi
      </Dialog>,
    );
    fireEvent.click(inDialog().getByRole('button', { name: 'Tutup dialog', hidden: true }));
    fireEvent(dialog(), new Event('cancel', { cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(2);

    onClose.mockReset();
    rerender(
      <Dialog open onClose={onClose} title="Judul" busy>
        Isi
      </Dialog>,
    );
    fireEvent(dialog(), new Event('cancel', { cancelable: true }));
    fireEvent.click(dialog());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps the title accessible when the header is hidden (drawer)', () => {
    renderWithIntl(
      <Dialog open onClose={vi.fn()} title="Navigasi" hideHeader placement="left">
        Menu
      </Dialog>,
    );
    const title = document.getElementById(dialog().getAttribute('aria-labelledby') as string);
    expect(title?.className).toContain('sr-only');
    expect(inDialog().queryByRole('button', { hidden: true })).toBeNull();
  });
});

describe('ConfirmDialog', () => {
  it('uses the danger button for destructive actions and confirms only on request', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    renderWithIntl(
      <ConfirmDialog
        open
        tone="danger"
        title="Nonaktifkan produk?"
        description="Produk tidak lagi dijual."
        confirmLabel="Nonaktifkan"
        cancelLabel="Batal"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    expect(onConfirm).not.toHaveBeenCalled();
    const confirm = inDialog().getByRole('button', { name: 'Nonaktifkan', hidden: true });
    expect(confirm.className).toContain('text-danger');
    expect(confirm.className).not.toContain('bg-primary');
    expect(confirm.getAttribute('type')).toBe('button');
    fireEvent.click(inDialog().getByRole('button', { name: 'Batal', hidden: true }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('uses the primary button otherwise', () => {
    renderWithIntl(
      <ConfirmDialog
        open
        title="Aktifkan produk?"
        confirmLabel="Aktifkan"
        cancelLabel="Batal"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const confirm = inDialog().getByRole('button', { name: 'Aktifkan', hidden: true });
    expect(confirm.className).toContain('bg-primary');
  });
});

describe('Icon and IconButton', () => {
  it('hides decorative icons and names labelled ones', () => {
    const { container } = renderWithIntl(
      <>
        <Icon name="orders" />
        <Icon name="warning" label="Peringatan" />
      </>,
    );
    const [decorative, labelled] = container.querySelectorAll('svg');
    expect(decorative?.getAttribute('aria-hidden')).toBe('true');
    expect(labelled?.getAttribute('aria-hidden')).toBeNull();
    expect(screen.getByRole('img', { name: 'Peringatan' })).toBeTruthy();
  });

  it('gives icon-only buttons an accessible name and a button type', () => {
    renderWithIntl(<IconButton icon="refresh" label="Muat ulang" />);
    const button = screen.getByRole('button', { name: 'Muat ulang' });
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('title')).toBe('Muat ulang');
  });
});
