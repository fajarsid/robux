'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type CopyStatus = 'idle' | 'copied' | 'failed';

const RESET_MS = 2_000;

/**
 * Copies text with the Clipboard API and reports the outcome for a short time. Failures (no
 * secure context, permission denied) are reported, not thrown, and the copied value is never
 * logged.
 */
export function useCopyToClipboard() {
  const [status, setStatus] = useState<CopyStatus>('idle');
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  const copy = useCallback(async (text: string) => {
    let next: CopyStatus = 'copied';
    try {
      if (!navigator.clipboard) {
        throw new Error('Clipboard API unavailable');
      }
      await navigator.clipboard.writeText(text);
    } catch {
      next = 'failed';
    }
    setStatus(next);
    clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setStatus('idle'), RESET_MS);
  }, []);

  return { status, copy };
}
