import type { CustomerOrderDetailView } from '@robux/shared';
import { notFound } from 'next/navigation';
import { PageShell } from '@/components/layout/PageShell';
import { CancelOrderButton } from '@/features/orders/components/CancelOrderButton';
import { OrderDetails } from '@/features/orders/components/OrderDetails';
import { PayOrderLink } from '@/features/payments/components/PayOrderLink';
import { serverApiGet } from '@/lib/api/server-api';
import { AccountHandoff } from '@/features/orders/components/AccountHandoff';

export default async function CustomerOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Ownership is enforced by the API: another customer's order is a 404, same as a missing one.
  const order = await serverApiGet<CustomerOrderDetailView>(`/me/orders/${encodeURIComponent(id)}`);
  if (!order) {
    notFound();
  }
  return (
    <PageShell className="py-10">
      <OrderDetails
        order={order}
        actions={
          <div className="flex flex-col gap-3">
            {order.stage === 'AWAITING_PAYMENT' && (
              <PayOrderLink access={{ kind: 'customer', orderId: order.id }} />
            )}
            <CancelOrderButton target={{ kind: 'customer', orderId: order.id }} />
          </div>
        }
        handoff={order.productLine === 'TELEGRAM_ACCOUNT' && order.stage === 'COMPLETED'
          ? <AccountHandoff target={{ kind: 'customer', orderId: order.id }} /> : undefined}
      />
    </PageShell>
  );
}
