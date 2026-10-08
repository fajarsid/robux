'use client';

import { useCallback, useRef } from 'react';
import { useApiAction } from '@/hooks/useApiAction';
import { idempotencyKeyFor, releaseIdempotencyKey } from '@/lib/api/idempotency-key';
import { paymentsService } from '../services/payments.service';
import type { OrderAccess, OrderPaymentState } from '../types/payment.types';

const IDEMPOTENCY_SCOPE = 'payment';

/**
 * Starts one payment attempt. The key is bound to the order number and the chosen method, so a
 * double click, a network retry or a reload re-sends the same key and the API returns the same
 * attempt; it is released only after the API answered, so a later new attempt gets a new key.
 * The order number (not the tracking token) is used because the fingerprint is kept in storage.
 */
export function useCreatePayment(access: OrderAccess, orderNumber: string) {
  const inFlight = useRef(false);

  const create = useCallback(
    async (paymentMethodId: string): Promise<OrderPaymentState> => {
      const key = idempotencyKeyFor(IDEMPOTENCY_SCOPE, `${orderNumber}:${paymentMethodId}`);
      const state = await paymentsService.create(access, { paymentMethod: paymentMethodId }, key);
      releaseIdempotencyKey(IDEMPOTENCY_SCOPE);
      return state;
    },
    [access, orderNumber],
  );
  const action = useApiAction(create);
  const { run } = action;

  const start = useCallback(
    async (paymentMethodId: string) => {
      if (inFlight.current) {
        return null;
      }
      inFlight.current = true;
      try {
        const result = await run(paymentMethodId);
        return result.ok ? result.value : null;
      } finally {
        inFlight.current = false;
      }
    },
    [run],
  );

  return { start, creating: action.state === 'loading', errorCode: action.errorCode };
}
