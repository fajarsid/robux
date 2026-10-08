import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { roleMayCancelOrders } from '@/features/console/orders/admin-order-permissions';
import { AdminOrderDetail } from '@/features/console/orders/components/AdminOrderDetail';
import { fetchAdminOrder } from '@/features/console/orders/services/admin-orders.server';
import { requireStaff } from '@/features/console/services/staff.server';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const order = await fetchAdminOrder((await params).id);
  return { title: order?.orderNumber };
}

export default async function ConsoleOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const [staff, order] = await Promise.all([requireStaff(), fetchAdminOrder((await params).id)]);
  if (!order) {
    notFound();
  }
  return <AdminOrderDetail order={order} mayCancel={roleMayCancelOrders(staff.role)} />;
}
