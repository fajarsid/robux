'use client';

import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import { Button } from './Button';
import type { ButtonSize } from './button-styles';

interface CopyButtonProps {
  value: string;
  /** Accessible name, e.g. "Salin nomor virtual account". */
  label: string;
  copyText: string;
  copiedText: string;
  failedText: string;
  size?: ButtonSize;
}

/** Copies `value`; the outcome is shown on the button and announced through a status region. */
export function CopyButton({
  value,
  label,
  copyText,
  copiedText,
  failedText,
  size = 'lg',
}: CopyButtonProps) {
  const { status, copy } = useCopyToClipboard();
  const text = status === 'copied' ? copiedText : status === 'failed' ? failedText : copyText;
  return (
    <>
      <Button
        variant="outline"
        size={size}
        icon={status === 'copied' ? 'success' : status === 'failed' ? 'error' : 'copy'}
        onClick={() => void copy(value)}
        aria-label={label}
        className={`min-w-20 ${status === 'copied' ? 'text-success' : status === 'failed' ? 'text-danger' : ''}`}
      >
        {text}
      </Button>
      <span role="status" className="sr-only">
        {status === 'idle' ? '' : text}
      </span>
    </>
  );
}
