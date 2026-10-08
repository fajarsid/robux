'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ApiError } from '@/lib/api/api-error';
import { paymentsService } from '../services/payments.service';
import type { OrderAccess, OrderPaymentState } from '../types/payment.types';

// Each poll reads the order and its payment (two requests); 10 s keeps a guest well inside the
// tracking rate limit (30 per minute per IP) even with a second tab open.
export const POLL_INTERVAL_MS = 10_000;
const MAX_BACKOFF_MS = 60_000;
const MAX_CONSECUTIVE_FAILURES = 5;
// The backend expiry sweep runs about once a minute, so the deadline passing in the browser is
// not yet the final state. Checking a little longer shows EXPIRED, or a payment that arrived at
// the last second, without the customer reloading.
const EXPIRY_GRACE_MS = 90_000;
const MAX_POLL_DURATION_MS = 30 * 60_000;
const ACCESS_DENIED = new Set(['ORDER_NOT_FOUND', 'NOT_FOUND', 'UNAUTHORIZED', 'FORBIDDEN']);

export interface PaymentStatusSnapshot {
  state: OrderPaymentState | null;
  errorCode: string | null;
  failures: number;
  denied: boolean;
}

interface TimedSnapshot extends PaymentStatusSnapshot {
  /** Decided when the answer arrives, so rendering never reads the clock. */
  nextDelay: number | null;
}

const INITIAL: TimedSnapshot = {
  state: null,
  errorCode: null,
  failures: 0,
  denied: false,
  nextDelay: null,
};

/**
 * When to ask the API again, or null to stop. Polling runs only while a payment is pending and
 * the order awaits payment, backs off on failures, and ends at the payment deadline (plus grace)
 * or after a fixed maximum, whichever is first.
 */
export function nextPollDelay(
  snapshot: PaymentStatusSnapshot,
  startedAt: number,
  now: number,
): number | null {
  const { state, failures, denied } = snapshot;
  if (denied || failures >= MAX_CONSECUTIVE_FAILURES) {
    return null;
  }
  if (state?.orderStage !== 'AWAITING_PAYMENT' || state.payment?.status !== 'PENDING') {
    return null;
  }
  const expiresAt = state.payment.expiresAt ? Date.parse(state.payment.expiresAt) : Infinity;
  const stopAt = Math.min(expiresAt + EXPIRY_GRACE_MS, startedAt + MAX_POLL_DURATION_MS);
  if (now >= stopAt) {
    return null;
  }
  return Math.min(POLL_INTERVAL_MS * 2 ** failures, MAX_BACKOFF_MS);
}

function subscribeVisibility(onChange: () => void): () => void {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}

function usePageVisible(): boolean {
  return useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState === 'visible',
    () => true,
  );
}

/**
 * The payment state of one order, from the backend only. A single timer exists at a time
 * (each answer schedules the next one and the effect cleanup clears it), hidden tabs do not
 * poll, and only one request is in flight.
 */
export function usePaymentStatus(access: OrderAccess) {
  const [snapshot, setSnapshot] = useState<TimedSnapshot>(INITIAL);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const visible = usePageVisible();
  const inFlight = useRef(false);
  const startedAt = useRef(0);

  const timed = useCallback(
    (next: PaymentStatusSnapshot, now: number): TimedSnapshot => ({
      ...next,
      nextDelay: nextPollDelay(next, startedAt.current, now),
    }),
    [],
  );

  // A promise chain rather than async/await: every state update then happens in a callback,
  // after the request, never synchronously inside the effect that starts it.
  const load = useCallback(() => {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    paymentsService
      .state(access)
      .then(
        (state) =>
          setSnapshot(timed({ state, errorCode: null, failures: 0, denied: false }, Date.now())),
        (error: unknown) => {
          const code = error instanceof ApiError ? error.code : 'generic';
          const now = Date.now();
          setSnapshot((previous) =>
            timed(
              {
                state: previous.state,
                errorCode: code,
                failures: previous.failures + 1,
                denied: ACCESS_DENIED.has(code),
              },
              now,
            ),
          );
        },
      )
      .finally(() => {
        inFlight.current = false;
        setRefreshing(false);
        setLoaded(true);
      });
  }, [access, timed]);

  useEffect(() => {
    startedAt.current = Date.now();
    load();
  }, [load]);

  useEffect(() => {
    if (!visible || snapshot.nextDelay === null) {
      return;
    }
    const timer = setTimeout(load, snapshot.nextDelay);
    return () => clearTimeout(timer);
  }, [snapshot, visible, load]);

  /** A manual check; it also restarts polling that stopped after repeated failures. */
  const refresh = useCallback(() => {
    if (inFlight.current) {
      return;
    }
    startedAt.current = Date.now();
    setRefreshing(true);
    load();
  }, [load]);

  /** Applies a state the API returned from another call, e.g. creating a payment. */
  const replace = useCallback(
    (state: OrderPaymentState) => {
      startedAt.current = Date.now();
      setSnapshot(timed({ state, errorCode: null, failures: 0, denied: false }, Date.now()));
    },
    [timed],
  );

  return {
    state: snapshot.state,
    errorCode: snapshot.errorCode,
    denied: snapshot.denied,
    polling: snapshot.nextDelay !== null,
    loaded,
    refreshing,
    refresh,
    replace,
  };
}
