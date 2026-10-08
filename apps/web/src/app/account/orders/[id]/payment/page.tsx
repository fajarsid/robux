import type { CustomerOrderDetailView } from '@robux/shared';
import { notFound } from 'next/navigation';
import { PageShell } from '@/components/layout/PageShell';
import { OrderPaymentScreen } from '@/features/payments/components/OrderPaymentScreen';
import { serverApiGet } from '@/lib/api/server-api';

export default async function CustomerOrderPaymentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Ownership is enforced by the API: another customer's order is a 404, same as a missing one.
  const order = await serverApiGet<CustomerOrderDetailView>(`/me/orders/${encodeURIComponent(id)}`);
  if (!order) {
    notFound();
  }
  return (
    <PageShell className="py-10">
      <OrderPaymentScreen order={order} access={{ kind: 'customer', orderId: order.id }} />
    </PageShell>
  );
}
