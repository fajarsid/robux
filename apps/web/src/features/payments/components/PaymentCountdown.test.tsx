import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithIntl } from '@/test/render-with-intl';
import { PaymentCountdown } from './PaymentCountdown';

describe('PaymentCountdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-10-05T07:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts down to the API deadline once per second', () => {
    renderWithIntl(<PaymentCountdown expiresAt="2026-10-05T07:29:42.000Z" />);
    expect(screen.getByRole('timer').textContent).toBe('29:42');
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(screen.getByRole('timer').textContent).toBe('29:40');
    expect(screen.getByText(/14\.29/)).toBeTruthy();
  });

  it('shows hours for long payment windows', () => {
    renderWithIntl(<PaymentCountdown expiresAt="2026-10-05T09:05:09.000Z" />);
    expect(screen.getByRole('timer').textContent).toBe('2:05:09');
  });

  it('says the time is up without declaring the payment expired', () => {
    renderWithIntl(<PaymentCountdown expiresAt="2026-10-05T07:00:01.000Z" />);
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(screen.queryByRole('timer')).toBeNull();
    expect(screen.getByText(/memeriksa status terakhir/)).toBeTruthy();
    expect(screen.queryByText('Kedaluwarsa')).toBeNull();
  });
});
