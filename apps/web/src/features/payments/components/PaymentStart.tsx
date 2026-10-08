'use client';

import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { Alert } from '@/components/feedback/Alert';
import { Button } from '@/components/ui/Button';
import { useCreatePayment } from '../hooks/useCreatePayment';
import { usePaymentMethods } from '../hooks/usePaymentMethods';
import type { OrderAccess, OrderPaymentState } from '../types/payment.types';
import { PaymentErrorAlert } from './PaymentErrorAlert';
import { PaymentMethodSelector } from './PaymentMethodSelector';

interface PaymentStartProps {
  access: OrderAccess;
  orderNumber: string;
  onCreated: (state: OrderPaymentState) => void;
  /** An attempt already exists (e.g. created by an earlier, interrupted request): show it. */
  onShowExisting: () => void;
}

const EXISTING_ATTEMPT = new Set(['PAYMENT_ALREADY_PENDING', 'PAYMENT_IN_PROGRESS']);

/** Choose one of the backend's methods and start a payment attempt for the stored order total. */
export function PaymentStart({
  access,
  orderNumber,
  onCreated,
  onShowExisting,
}: PaymentStartProps) {
  const t = useTranslations('payment.start');
  const { methods, errorCode: methodsError, loading, retry } = usePaymentMethods();
  const { start, creating, errorCode } = useCreatePayment(access, orderNumber);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectable = methods?.filter((method) => method.available) ?? [];
  const selected = selectable.some((method) => method.id === selectedId) ? selectedId : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selected) {
      return;
    }
    const state = await start(selected);
    if (state) {
      onCreated(state);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <div>
        <h2 className="text-xl font-semibold">{t('title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('body')}</p>
      </div>
      {loading ? (
        <p className="text-sm text-muted-foreground" role="status">
          {t('loadingMethods')}
        </p>
      ) : methodsError ? (
        <div className="flex flex-col gap-3">
          <PaymentErrorAlert code={methodsError} />
          <Button type="button" variant="outline" onClick={retry}>
            {t('reloadMethods')}
          </Button>
        </div>
      ) : selectable.length === 0 ? (
        <Alert tone="info">{t('noMethods')}</Alert>
      ) : (
        <PaymentMethodSelector
          methods={methods ?? []}
          selectedId={selected}
          disabled={creating}
          onSelect={setSelectedId}
        />
      )}
      <PaymentErrorAlert code={errorCode} />
      {errorCode && EXISTING_ATTEMPT.has(errorCode) ? (
        <Button type="button" variant="outline" onClick={onShowExisting}>
          {t('showExisting')}
        </Button>
      ) : (
        <Button type="submit" loading={creating} disabled={!selected}>
          {creating ? t('submitting') : t('submit')}
        </Button>
      )}
    </form>
  );
}
