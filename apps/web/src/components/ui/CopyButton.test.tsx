import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CopyButton } from './CopyButton';

function setup() {
  render(
    <CopyButton
      value="8808123456789012"
      label="Salin nomor"
      copyText="Salin"
      copiedText="Tersalin"
      failedText="Gagal menyalin"
    />,
  );
  return screen.getByRole('button', { name: 'Salin nomor' });
}

function mockClipboard(writeText: () => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
}

describe('CopyButton', () => {
  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  });

  it('copies the value and announces success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    mockClipboard(writeText);
    fireEvent.click(setup());
    expect((await screen.findByRole('status')).textContent).toBe('Tersalin');
    expect(writeText).toHaveBeenCalledWith('8808123456789012');
  });

  it('reports a failure instead of throwing, without logging the value', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockClipboard(vi.fn().mockRejectedValue(new Error('denied')));
    fireEvent.click(setup());
    expect((await screen.findByRole('status')).textContent).toBe('Gagal menyalin');
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('reports a failure when the Clipboard API is missing', async () => {
    fireEvent.click(setup());
    expect((await screen.findByRole('status')).textContent).toBe('Gagal menyalin');
  });

  it('is a real button reachable by keyboard', () => {
    const button = setup();
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('type')).toBe('button');
  });
});
