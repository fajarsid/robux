import type { AdminProductView } from '@robux/shared';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { catalogHealth } from '@/features/console/dashboard/catalog-health';
import { DashboardScreen } from '@/features/console/dashboard/components/DashboardScreen';
import { fetchAdminOrderList } from '@/features/console/orders/services/admin-orders.server';
import { requireStaff } from '@/features/console/services/staff.server';
import { serverApiGet, serverSession } from '@/lib/api/server-api';

const RECENT_ORDERS = { page: 1, pageSize: 5 };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('console.dashboard'))('title') };
}

export default async function ConsoleDashboardPage() {
  const [staff, session, products, recentOrders] = await Promise.all([
    requireStaff(),
    serverSession(),
    serverApiGet<AdminProductView[]>('/admin/products'),
    fetchAdminOrderList(RECENT_ORDERS),
  ]);
  return (
    <DashboardScreen
      staffName={staff.name ?? staff.email}
      twoFactorEnabled={session.authenticated && session.twoFactor === 'VERIFIED'}
      catalog={products ? catalogHealth(products) : null}
      recentOrders={recentOrders}
    />
  );
}
