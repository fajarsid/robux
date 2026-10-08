import type { OrderPaymentState } from './types/payment.types';

export type PaymentScreen =
  | 'start'
  | 'pending'
  | 'paid'
  | 'failed'
  | 'expired'
  | 'cancelled'
  | 'orderCancelled'
  | 'refund'
  | 'unavailable';

/**
 * Picks the screen for the state the API reported. Nothing here decides whether a payment
 * succeeded or may be retried: those come from `payment.status`, `orderStage` and
 * `canCreatePayment` as returned by the backend.
 */
export function paymentScreenFor({
  orderStage,
  payment,
  canCreatePayment,
}: OrderPaymentState): PaymentScreen {
  if (payment?.status === 'PAID' || orderStage === 'PROCESSING' || orderStage === 'COMPLETED') {
    return 'paid';
  }
  if (
    payment?.status === 'REFUND_PENDING' ||
    payment?.status === 'REFUNDED' ||
    orderStage === 'REFUND_IN_PROGRESS' ||
    orderStage === 'REFUNDED'
  ) {
    return 'refund';
  }
  if (orderStage === 'CANCELLED') {
    return 'orderCancelled';
  }
  switch (payment?.status) {
    case undefined:
      return canCreatePayment ? 'start' : 'unavailable';
    case 'PENDING':
      return 'pending';
    case 'FAILED':
      return 'failed';
    case 'EXPIRED':
      return 'expired';
    default:
      return 'cancelled';
  }
}
