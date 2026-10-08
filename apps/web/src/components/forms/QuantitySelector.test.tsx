import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QuantitySelector } from './QuantitySelector';

function setup(value: number, onChange = vi.fn()) {
  render(
    <QuantitySelector
      value={value}
      min={1}
      max={5}
      onChange={onChange}
      label="Jumlah"
      decreaseLabel="Kurangi"
      increaseLabel="Tambah"
    />,
  );
  return onChange;
}

describe('QuantitySelector', () => {
  it('steps within the limits', () => {
    const onChange = setup(3);
    fireEvent.click(screen.getByRole('button', { name: 'Tambah' }));
    fireEvent.click(screen.getByRole('button', { name: 'Kurangi' }));
    expect(onChange.mock.calls).toEqual([[4], [2]]);
  });

  it('disables the buttons at the bounds', () => {
    setup(1);
    expect(screen.getByRole('button', { name: 'Kurangi' })).toHaveProperty('disabled', true);
  });

  it('clamps typed values into the allowed range', () => {
    const onChange = setup(2);
    const input = screen.getByRole('spinbutton', { name: 'Jumlah' });
    fireEvent.change(input, { target: { value: '99' } });
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.change(input, { target: { value: '2.7' } });
    expect(onChange.mock.calls).toEqual([[5], [1], [2]]);
  });
});
