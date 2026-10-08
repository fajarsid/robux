'use client';

import type { PaymentView } from '@robux/shared';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { PaymentCountdown } from './PaymentCountdown';
import { PaymentErrorAlert } from './PaymentErrorAlert';
import { PaymentInstructions } from './PaymentInstructions';

interface PaymentPendingProps {
  payment: PaymentView;
  polling: boolean;
  refreshing: boolean;
  errorCode: string | null;
  onRefresh: () => void;
}

/** Waiting for the backend to confirm the payment; nothing here can mark it paid. */
export function PaymentPending({
  payment,
  polling,
  refreshing,
  errorCode,
  onRefresh,
}: PaymentPendingProps) {
  const t = useTranslations('payment.pending');
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold">{t('title')}</h2>
        <p className="mt-1 text-muted-foreground">{t('body')}</p>
      </div>
      {payment.expiresAt && <PaymentCountdown expiresAt={payment.expiresAt} />}
      <PaymentInstructions payment={payment} />
      <div className="flex flex-col gap-3 border-t border-border pt-5">
        <PaymentErrorAlert code={errorCode} />
        <Button variant="outline" onClick={onRefresh} loading={refreshing}>
          {refreshing ? t('refreshing') : t('refresh')}
        </Button>
        <p className="text-xs text-muted-foreground">
          {polling ? t('autoRefresh') : t('manualRefresh')}
        </p>
        <p className="text-xs text-muted-foreground">{t('confirmedByUs')}</p>
      </div>
    </div>
  );
}
