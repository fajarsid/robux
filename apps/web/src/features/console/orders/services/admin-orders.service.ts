import type { AdminOrderView } from '@robux/shared';
import { apiSend } from '@/lib/api/browser-api';

export const adminOrdersService = {
  /** The API re-checks `orders.cancel` and the order's state; it returns the updated order. */
  cancel: (orderId: string, reason: string) =>
    apiSend<AdminOrderView>('POST', `/admin/orders/${encodeURIComponent(orderId)}/cancel`, {
      reason,
    }),
};
