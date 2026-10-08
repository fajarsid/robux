import type { CustomerOrderDetailView, GuestOrderTrackingView } from '@robux/shared';
import { apiSend } from '@/lib/api/browser-api';

export type CancelTarget =
  { kind: 'customer'; orderId: string } | { kind: 'guest'; trackingToken: string };

export const ordersService = {
  /** Cancels an unpaid order; cancelling an already cancelled order succeeds again. */
  cancel: (target: CancelTarget) =>
    target.kind === 'customer'
      ? apiSend<CustomerOrderDetailView>(
          'POST',
          `/me/orders/${encodeURIComponent(target.orderId)}/cancel`,
        )
      : apiSend<GuestOrderTrackingView>(
          'POST',
          `/track/${encodeURIComponent(target.trackingToken)}/cancel`,
        ),
};
