import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DropdownMenu } from './DropdownMenu';

function renderMenu(onEdit = vi.fn(), onDelete = vi.fn()) {
  render(
    <DropdownMenu
      label="Tindakan"
      trigger={(props) => (
        <button type="button" {...props}>
          Buka menu
        </button>
      )}
      items={[
        { label: 'Edit', onSelect: onEdit },
        { label: 'Nonaktif', onSelect: vi.fn(), disabled: true },
        { label: 'Hapus', onSelect: onDelete, tone: 'danger' },
      ]}
    />,
  );
  return screen.getByRole('button', { name: 'Buka menu' });
}

describe('DropdownMenu', () => {
  it('opens on click, focuses the first item and reports its state', () => {
    const trigger = renderMenu();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('menu', { name: 'Tindakan' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Edit' }));
  });

  it('moves with the arrow keys, skipping disabled items and wrapping around', () => {
    const trigger = renderMenu();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const menu = screen.getByRole('menu');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toBe('Hapus');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toBe('Edit');
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement?.textContent).toBe('Hapus');
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(document.activeElement?.textContent).toBe('Edit');
    fireEvent.keyDown(menu, { key: 'End' });
    expect(document.activeElement?.textContent).toBe('Hapus');
  });

  it('closes on Escape and returns focus to the trigger', () => {
    const trigger = renderMenu();
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('runs the chosen action once and closes', () => {
    const onDelete = vi.fn();
    const trigger = renderMenu(vi.fn(), onDelete);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hapus' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on a click outside', () => {
    const trigger = renderMenu();
    fireEvent.click(trigger);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
