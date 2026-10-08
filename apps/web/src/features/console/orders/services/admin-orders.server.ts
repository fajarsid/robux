import type { AdminOrderView } from '@robux/shared';
import { serverApiGet } from '@/lib/api/server-api';
import { toOrderListApiPath } from '../order-list-query';
import type { AdminOrderListQuery, AdminOrderListView } from '../types/admin-orders';

export type OrderListResult =
  { kind: 'ok'; list: AdminOrderListView } | { kind: 'unavailable' } | { kind: 'error' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A malformed id is treated as not found instead of surfacing the API's 400 as a page error. */
export async function fetchAdminOrder(orderId: string): Promise<AdminOrderView | null> {
  if (!UUID.test(orderId)) {
    return null;
  }
  return serverApiGet<AdminOrderView>(`/admin/orders/${encodeURIComponent(orderId)}`);
}

/**
 * Called only after the staff check (console layout), so a refusal here means the list endpoint itself is not
 * served (or not granted), which the page reports instead of bouncing to the login.
 */
export async function fetchAdminOrderList(query: AdminOrderListQuery): Promise<OrderListResult> {
  try {
    const list = await serverApiGet<AdminOrderListView>(toOrderListApiPath(query));
    return list ? { kind: 'ok', list } : { kind: 'unavailable' };
  } catch {
    return { kind: 'error' };
  }
}
