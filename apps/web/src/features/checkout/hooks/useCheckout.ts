'use client';

import type { CreateOrderRequest, OrderCreatedView } from '@robux/shared';
import { useCallback, useState } from 'react';
import { ApiError } from '@/lib/api/api-error';
import { idempotencyKeyFor, releaseIdempotencyKey } from '@/lib/api/idempotency-key';
import { checkoutService } from '../services/checkout.service';

const IDEMPOTENCY_SCOPE = 'checkout';

export function useCheckout() {
  const [submitting, setSubmitting] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [order, setOrder] = useState<OrderCreatedView | null>(null);

  const placeOrder = useCallback(async (request: CreateOrderRequest) => {
    setSubmitting(true);
    setErrorCode(null);
    try {
      const key = idempotencyKeyFor(IDEMPOTENCY_SCOPE, JSON.stringify(request));
      const created = await checkoutService.placeOrder(request, key);
      releaseIdempotencyKey(IDEMPOTENCY_SCOPE);
      setOrder(created);
      return true;
    } catch (error) {
      setErrorCode(error instanceof ApiError ? error.code : 'generic');
      return false;
    } finally {
      setSubmitting(false);
    }
  }, []);

  const clearError = useCallback(() => setErrorCode(null), []);

  return { placeOrder, submitting, errorCode, clearError, order };
}
