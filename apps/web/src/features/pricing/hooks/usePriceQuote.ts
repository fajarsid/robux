'use client';

import type { PriceQuoteView } from '@robux/shared';
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/lib/api/api-error';
import { pricingService } from '../services/pricing.service';

const DEBOUNCE_MS = 250;

interface QuoteResult {
  key: string;
  quote: PriceQuoteView | null;
  errorCode: string | null;
}

/**
 * Asks the API for the total of `quantity` units; the browser never computes totals itself.
 * The result is tagged with the request it answers, so it is "loading" until the latest answer
 * arrives and stale answers are never shown. `refresh` asks again for the same quantity, e.g.
 * after the API reported that the price changed.
 */
export function usePriceQuote(slug: string, quantity: number) {
  const [revision, setRevision] = useState(0);
  const key = `${slug}:${quantity}:${revision}`;
  const [result, setResult] = useState<QuoteResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      pricingService
        .quote(slug, quantity)
        .then((quote) => !cancelled && setResult({ key, quote, errorCode: null }))
        .catch(
          (error: unknown) =>
            !cancelled &&
            setResult({
              key,
              quote: null,
              errorCode: error instanceof ApiError ? error.code : 'generic',
            }),
        );
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, slug, quantity]);

  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const current = result?.key === key ? result : null;
  return {
    quote: current?.quote ?? null,
    loading: current === null,
    errorCode: current?.errorCode ?? null,
    refresh,
  };
}
