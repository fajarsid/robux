import type { GuestOrderTrackingView } from '@robux/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageShell } from '@/components/layout/PageShell';
import { OrderPaymentScreen } from '@/features/payments/components/OrderPaymentScreen';
import { serverApiGet } from '@/lib/api/server-api';

// The token in the URL is a credential: keep it out of Referer headers and search indexes.
export const metadata: Metadata = {
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

export default async function GuestOrderPaymentPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const order = await serverApiGet<GuestOrderTrackingView>(`/track/${encodeURIComponent(token)}`);
  if (!order) {
    notFound();
  }
  return (
    <PageShell className="py-10">
      <OrderPaymentScreen order={order} access={{ kind: 'guest', trackingToken: token }} />
    </PageShell>
  );
}
