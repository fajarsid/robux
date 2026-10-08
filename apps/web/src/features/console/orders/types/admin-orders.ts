import {
  ORDER_STATUSES,
  type OrderStatusName,
  PAYMENT_STATUSES,
  type PaymentStatusView,
} from '@robux/shared';

// The contract lives in @robux/shared; these names keep the admin UI vocabulary short.
export type {
  AdminOrderListQuery,
  AdminOrderListView,
  AdminOrderSummaryView,
  OrderStatusName as OrderStatus,
  PaymentStatusView as PaymentStatus,
} from '@robux/shared';
export { ORDER_STATUSES, PAYMENT_STATUSES };

export function isOrderStatus(value: string): value is OrderStatusName {
  return (ORDER_STATUSES as readonly string[]).includes(value);
}

export function isPaymentStatus(value: string): value is PaymentStatusView {
  return (PAYMENT_STATUSES as readonly string[]).includes(value);
}
