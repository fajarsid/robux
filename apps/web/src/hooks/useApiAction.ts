'use client';

import { useCallback, useState } from 'react';
import { ApiError } from '@/lib/api/api-error';

export type ActionState = 'idle' | 'loading' | 'success' | 'error';

export type ActionResult<T> = { ok: true; value: T } | { ok: false };

/** idle → loading → success | error for one API action, with the error code for UI copy. */
export function useApiAction<TArgs extends unknown[], TResult>(
  action: (...args: TArgs) => Promise<TResult>,
) {
  const [state, setState] = useState<ActionState>('idle');
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const run = useCallback(
    async (...args: TArgs): Promise<ActionResult<TResult>> => {
      setState('loading');
      setErrorCode(null);
      try {
        const value = await action(...args);
        setState('success');
        return { ok: true, value };
      } catch (error) {
        setErrorCode(error instanceof ApiError ? error.code : 'generic');
        setState('error');
        return { ok: false };
      }
    },
    [action],
  );

  return { state, errorCode, run };
}
