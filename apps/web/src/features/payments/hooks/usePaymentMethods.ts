'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/lib/api/api-error';
import { paymentsService } from '../services/payments.service';
import type { PaymentMethod } from '../types/payment.types';

interface MethodsResult {
  revision: number;
  methods: PaymentMethod[] | null;
  errorCode: string | null;
}

/** The methods the backend offers; the list is never defined in the browser. */
export function usePaymentMethods() {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<MethodsResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    paymentsService
      .methods()
      .then((methods) => !cancelled && setResult({ revision, methods, errorCode: null }))
      .catch(
        (error: unknown) =>
          !cancelled &&
          setResult({
            revision,
            methods: null,
            errorCode: error instanceof ApiError ? error.code : 'generic',
          }),
      );
    return () => {
      cancelled = true;
    };
  }, [revision]);

  const retry = useCallback(() => setRevision((value) => value + 1), []);
  const current = result?.revision === revision ? result : null;
  return {
    methods: current?.methods ?? null,
    errorCode: current?.errorCode ?? null,
    loading: current === null,
    retry,
  };
}
