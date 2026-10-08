import type {
  PayableOrder,
  PayableOrderService,
} from '../../orders/application/payable-order.service';

/** How the caller proves access to an order: ownership (signed-in customer) or the guest token. */
export type PaymentOrderAccess =
  | { kind: 'customer'; userId: string; orderId: string }
  | { kind: 'telegram'; telegramUserId: bigint; orderId: string }
  | { kind: 'guest'; trackingToken: string };

export function resolvePayableOrder(
  orders: PayableOrderService,
  access: PaymentOrderAccess,
): Promise<PayableOrder> {
  if (access.kind === 'customer') return orders.forCustomer(access.userId, access.orderId);
  if (access.kind === 'telegram') return orders.forTelegram(access.telegramUserId, access.orderId);
  return orders.forTrackingToken(access.trackingToken);
}
