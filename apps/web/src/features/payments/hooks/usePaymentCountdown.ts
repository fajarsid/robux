'use client';

import { useEffect, useState } from 'react';

/**
 * Milliseconds left until `expiresAt` (never negative), ticking once per second until it
 * reaches zero. Display only: whether the payment really expired is reported by the API.
 */
export function usePaymentCountdown(expiresAt: string | null): number | null {
  const deadline = expiresAt ? Date.parse(expiresAt) : null;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (deadline === null) {
      return;
    }
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= deadline) {
        clearInterval(timer);
      }
    }, 1_000);
    return () => clearInterval(timer);
  }, [deadline]);

  return deadline === null || Number.isNaN(deadline) ? null : Math.max(0, deadline - now);
}
