'use client';

import type { GuestOrderTrackingView } from '@robux/shared';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Card } from '@/components/ui/Card';
import { OrderSummary } from '@/features/checkout/components/OrderSummary';
import { usePaymentStatus } from '../hooks/usePaymentStatus';
import { orderHref as orderHrefFor } from '../payment-links';
import { paymentScreenFor } from '../payment-screen';
import type { OrderAccess, OrderPaymentState } from '../types/payment.types';
import { PaymentClosed } from './PaymentClosed';
import { PaymentCopyField } from './PaymentCopyField';
import { PaymentErrorAlert } from './PaymentErrorAlert';
import { PaymentPending } from './PaymentPending';
import { PaymentStart } from './PaymentStart';
import { PaymentStatusBadge } from './PaymentStatusBadge';
import { PaymentSuccess } from './PaymentSuccess';

interface OrderPaymentScreenProps {
  order: GuestOrderTrackingView;
  access: OrderAccess;
}

/** Payment page body: renders whichever step the backend's payment state calls for. */
export function OrderPaymentScreen({ order, access }: OrderPaymentScreenProps) {
  const t = useTranslations('payment');
  const status = usePaymentStatus(access);
  const [choosingMethod, setChoosingMethod] = useState(false);
  const orderHref = orderHrefFor(access);

  function created(state: OrderPaymentState) {
    setChoosingMethod(false);
    status.replace(state);
  }

  function showExisting() {
    setChoosingMethod(false);
    status.refresh();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <Card className="flex flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          {/* Polling can change the status while the customer waits; announce it politely. */}
          <div aria-live="polite">
            {status.state?.payment && <PaymentStatusBadge status={status.state.payment.status} />}
          </div>
        </div>
        {/* The gateway shows the order number as the bill name; customers quote it to support. */}
        <PaymentCopyField label={t('orderNumber')} value={order.orderNumber} />
        {status.state ? (
          <PaymentStep
            state={status.state}
            choosingMethod={choosingMethod}
            access={access}
            orderNumber={order.orderNumber}
            orderHref={orderHref}
            polling={status.polling}
            refreshing={status.refreshing}
            errorCode={status.errorCode}
            onRefresh={status.refresh}
            onRetry={() => setChoosingMethod(true)}
            onCreated={created}
            onShowExisting={showExisting}
          />
        ) : !status.loaded ? (
          <p className="text-muted-foreground" role="status">
            {t('loading')}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <PaymentErrorAlert code={status.errorCode} />
            {status.errorCode === 'UNAUTHORIZED' ? (
              <ButtonLink href="/login">{t('login')}</ButtonLink>
            ) : (
              !status.denied && (
                <Button onClick={status.refresh} loading={status.refreshing}>
                  {t('retryLoad')}
                </Button>
              )
            )}
            <ButtonLink href={orderHref} variant="outline">
              {t('viewOrder')}
            </ButtonLink>
          </div>
        )}
      </Card>
      <Card className="h-fit">
        <OrderSummary pricing={order.pricing} />
      </Card>
    </div>
  );
}

interface PaymentStepProps {
  state: OrderPaymentState;
  choosingMethod: boolean;
  access: OrderAccess;
  orderNumber: string;
  orderHref: string;
  polling: boolean;
  refreshing: boolean;
  errorCode: string | null;
  onRefresh: () => void;
  onRetry: () => void;
  onCreated: (state: OrderPaymentState) => void;
  onShowExisting: () => void;
}

function PaymentStep({
  state,
  choosingMethod,
  access,
  orderNumber,
  orderHref,
  polling,
  refreshing,
  errorCode,
  onRefresh,
  onRetry,
  onCreated,
  onShowExisting,
}: PaymentStepProps) {
  const screen = paymentScreenFor(state);
  if (screen === 'start' || (choosingMethod && state.canCreatePayment)) {
    return (
      <PaymentStart
        access={access}
        orderNumber={orderNumber}
        onCreated={onCreated}
        onShowExisting={onShowExisting}
      />
    );
  }
  if (screen === 'pending' && state.payment) {
    return (
      <PaymentPending
        payment={state.payment}
        polling={polling}
        refreshing={refreshing}
        errorCode={errorCode}
        onRefresh={onRefresh}
      />
    );
  }
  if (screen === 'paid') {
    return <PaymentSuccess payment={state.payment} orderHref={orderHref} />;
  }
  return (
    <PaymentClosed
      reason={screen === 'pending' ? 'unavailable' : screen}
      canCreatePayment={state.canCreatePayment}
      orderHref={orderHref}
      onRetry={onRetry}
    />
  );
}
