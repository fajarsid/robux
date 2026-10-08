'use client';

import { useTranslations } from 'next-intl';
import { CopyButton } from '@/components/ui/CopyButton';

/** A value the customer has to type or paste elsewhere (VA number, payment code, reference). */
export function PaymentCopyField({ label, value }: { label: string; value: string }) {
  const t = useTranslations('payment.instructions');
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <div className="flex items-center justify-between gap-3 rounded-control border border-border bg-surface-muted px-4 py-2">
        <span className="min-w-0 font-mono text-lg font-semibold tracking-wide break-all select-all">
          {value}
        </span>
        <CopyButton
          value={value}
          label={t('copyLabel', { field: label })}
          copyText={t('copy')}
          copiedText={t('copied')}
          failedText={t('copyFailed')}
        />
      </div>
    </div>
  );
}
