import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { paymentsService } from '../services/payments.service';
import { guestAccess, payment, paymentState } from '../testing/payment-fixtures';
import { nextPollDelay, POLL_INTERVAL_MS, usePaymentStatus } from './usePaymentStatus';

vi.mock('../services/payments.service', () => ({
  paymentsService: { state: vi.fn(), methods: vi.fn(), create: vi.fn() },
}));

const NOW = Date.parse('2026-10-05T07:00:00.000Z');
const pending = { state: paymentState(), errorCode: null, failures: 0, denied: false };

describe('nextPollDelay', () => {
  it('polls a pending payment at the base interval', () => {
    expect(nextPollDelay(pending, NOW, NOW)).toBe(POLL_INTERVAL_MS);
  });

  it('stops on every terminal payment status', () => {
    for (const status of ['PAID', 'FAILED', 'EXPIRED', 'CANCELLED', 'REFUNDED'] as const) {
      const state = paymentState({ payment: payment({ status }) });
      expect(nextPollDelay({ ...pending, state }, NOW, NOW)).toBeNull();
    }
  });

  it('stops when the order no longer awaits payment', () => {
    const state = paymentState({ orderStage: 'CANCELLED' });
    expect(nextPollDelay({ ...pending, state }, NOW, NOW)).toBeNull();
  });

  it('stops shortly after the payment deadline', () => {
    const expiresAt = Date.parse(payment().expiresAt!);
    const startedAt = expiresAt - 60_000;
    expect(nextPollDelay(pending, startedAt, expiresAt + 30_000)).toBe(POLL_INTERVAL_MS);
    expect(nextPollDelay(pending, startedAt, expiresAt + 120_000)).toBeNull();
  });

  it('does not poll forever when the payment has no deadline', () => {
    const state = paymentState({ payment: payment({ expiresAt: null }) });
    expect(nextPollDelay({ ...pending, state }, NOW, NOW + 29 * 60_000)).not.toBeNull();
    expect(nextPollDelay({ ...pending, state }, NOW, NOW + 31 * 60_000)).toBeNull();
  });

  it('backs off on failures, then gives up', () => {
    expect(nextPollDelay({ ...pending, failures: 1 }, NOW, NOW)).toBe(POLL_INTERVAL_MS * 2);
    expect(nextPollDelay({ ...pending, failures: 4 }, NOW, NOW)).toBeLessThanOrEqual(60_000);
    expect(nextPollDelay({ ...pending, failures: 5 }, NOW, NOW)).toBeNull();
  });

  it('stops when access is denied', () => {
    expect(nextPollDelay({ ...pending, denied: true }, NOW, NOW)).toBeNull();
  });
});

describe('usePaymentStatus', () => {
  const state = vi.mocked(paymentsService.state);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(NOW);
    state.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function flush() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  /** One act per poll cycle: React schedules the next timer only after it commits the answer. */
  async function advancePolls(cycles: number, ms = POLL_INTERVAL_MS) {
    for (let i = 0; i < cycles; i += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    }
  }

  it('polls while pending and stops once the backend reports PAID', async () => {
    state
      .mockResolvedValueOnce(paymentState())
      .mockResolvedValueOnce(paymentState())
      .mockResolvedValue(paymentState({ payment: payment({ status: 'PAID' }) }));
    const { result } = renderHook(() => usePaymentStatus(guestAccess));
    await flush();
    expect(result.current.polling).toBe(true);

    await advancePolls(2);
    expect(result.current.state?.payment?.status).toBe('PAID');
    expect(result.current.polling).toBe(false);

    const calls = state.mock.calls.length;
    await advancePolls(10);
    expect(state.mock.calls.length).toBe(calls);
  });

  it('keeps one timer at a time and clears it on unmount', async () => {
    state.mockResolvedValue(paymentState());
    const { unmount } = renderHook(() => usePaymentStatus(guestAccess));
    await flush();
    expect(state).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
    expect(state).toHaveBeenCalledTimes(2);

    unmount();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5);
    expect(state).toHaveBeenCalledTimes(2);
  });

  it('stops polling after an access error', async () => {
    state.mockRejectedValue(new ApiError(404, 'ORDER_NOT_FOUND', ''));
    const { result } = renderHook(() => usePaymentStatus(guestAccess));
    await flush();
    expect(result.current.denied).toBe(true);
    await advancePolls(10);
    expect(state).toHaveBeenCalledTimes(1);
  });

  it('keeps the last known state through a network failure and backs off', async () => {
    state
      .mockResolvedValueOnce(paymentState())
      .mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', ''))
      .mockResolvedValue(paymentState());
    const { result } = renderHook(() => usePaymentStatus(guestAccess));
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
    expect(result.current.errorCode).toBe('NETWORK_ERROR');
    expect(result.current.state?.payment?.status).toBe('PENDING');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
    expect(state).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
    expect(state).toHaveBeenCalledTimes(3);
    expect(result.current.errorCode).toBeNull();
  });

  it('pauses while the tab is hidden', async () => {
    state.mockResolvedValue(paymentState());
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    renderHook(() => usePaymentStatus(guestAccess));
    await flush();
    await advancePolls(5);
    expect(state).toHaveBeenCalledTimes(1);

    visibility.mockReturnValue('visible');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
    expect(state).toHaveBeenCalledTimes(2);
    visibility.mockRestore();
  });
});
