import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AdminOrdersScreen } from '@/features/console/orders/components/AdminOrdersScreen';
import { parseOrderListQuery } from '@/features/console/orders/order-list-query';
import { fetchAdminOrderList } from '@/features/console/orders/services/admin-orders.server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('adminOrders'))('title') };
}

export default async function ConsoleOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = parseOrderListQuery(await searchParams);
  const result = await fetchAdminOrderList(query);
  return <AdminOrdersScreen query={query} result={result} />;
}
