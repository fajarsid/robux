import type { GuestOrderTrackingView } from '@robux/shared';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PageShell } from '@/components/layout/PageShell';
import { CancelOrderButton } from '@/features/orders/components/CancelOrderButton';
import { OrderDetails } from '@/features/orders/components/OrderDetails';
import { PayOrderLink } from '@/features/payments/components/PayOrderLink';
import { serverApiGet } from '@/lib/api/server-api';
import { AccountHandoff } from '@/features/orders/components/AccountHandoff';

// The token in the URL is a credential: keep it out of Referer headers and search indexes.
export const metadata: Metadata = {
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

export default async function GuestOrderTrackingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const order = await serverApiGet<GuestOrderTrackingView>(`/track/${encodeURIComponent(token)}`);
  if (!order) {
    const t = await getTranslations('order');
    return (
      <PageShell className="py-24">
        <h1 className="text-2xl font-semibold">{t('notFoundTitle')}</h1>
        <p className="mt-3 text-muted-foreground">{t('notFoundBody')}</p>
      </PageShell>
    );
  }
  return (
    <PageShell className="py-10">
      <OrderDetails
        order={order}
        actions={
          <div className="flex flex-col gap-3">
            {order.stage === 'AWAITING_PAYMENT' && (
              <PayOrderLink access={{ kind: 'guest', trackingToken: token }} />
            )}
            <CancelOrderButton target={{ kind: 'guest', trackingToken: token }} />
          </div>
        }
        handoff={order.productLine === 'TELEGRAM_ACCOUNT' && order.stage === 'COMPLETED'
          ? <AccountHandoff target={{ kind: 'guest', trackingToken: token }} /> : undefined}
      />
    </PageShell>
  );
}
