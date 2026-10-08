'use client';

import { useTranslations } from 'next-intl';
import { formatDateTime } from '@/lib/format/format';
import { usePaymentCountdown } from '../hooks/usePaymentCountdown';

function formatRemaining(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/** The API deadline as a date and a live countdown. Reaching zero does not mark anything expired. */
export function PaymentCountdown({ expiresAt }: { expiresAt: string }) {
  const t = useTranslations('payment.pending');
  const remaining = usePaymentCountdown(expiresAt);
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-2 gap-4">
        <div>
          <dt className="text-sm text-muted-foreground">{t('deadline')}</dt>
          <dd className="font-medium">{formatDateTime(expiresAt)}</dd>
        </div>
        {remaining !== null && remaining > 0 && (
          <div>
            <dt className="text-sm text-muted-foreground">{t('remaining')}</dt>
            {/* Not a live region: announcing every second would drown out everything else. */}
            <dd role="timer" className="font-mono text-lg font-semibold text-primary tabular-nums">
              {formatRemaining(remaining)}
            </dd>
          </div>
        )}
      </dl>
      {remaining === 0 && <p className="text-sm text-warning">{t('timeUp')}</p>}
    </div>
  );
}
