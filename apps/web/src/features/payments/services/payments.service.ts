import type {
  CreatePaymentRequest,
  GuestOrderTrackingView,
  PaymentMethodsView,
  PaymentView,
  PublicOrderStage,
} from '@robux/shared';
import { ApiError } from '@/lib/api/api-error';
import { apiGet, apiSend } from '@/lib/api/browser-api';
import type { OrderAccess, OrderPaymentState, PaymentMethod } from '../types/payment.types';

/**
 * Order-scoped payment calls use the same access routes as tracking and cancellation
 * (`/track/{token}` for guests, `/me/orders/{id}` for customers), so the API applies the order
 * ownership checks. The `/payment` sub-paths are the agreed shape pending the payments controller.
 */
function orderPath(access: OrderAccess): string {
  return access.kind === 'guest'
    ? `/track/${encodeURIComponent(access.trackingToken)}`
    : `/me/orders/${encodeURIComponent(access.orderId)}`;
}

async function latestPayment(access: OrderAccess): Promise<PaymentView | null> {
  try {
    return await apiGet<PaymentView>(`${orderPath(access)}/payment`);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'PAYMENT_NOT_FOUND') {
      return null;
    }
    throw error;
  }
}

const RETRYABLE_ATTEMPTS: ReadonlySet<PaymentView['status']> = new Set([
  'FAILED',
  'EXPIRED',
  'CANCELLED',
]);

/**
 * Until the API reports retry eligibility itself, a new attempt is offered only for an order the
 * API still reports as awaiting payment whose latest attempt is closed. The API re-checks it
 * (ORDER_NOT_PAYABLE, PAYMENT_ALREADY_PENDING), so this only decides whether to show the button.
 */
function toState(orderStage: PublicOrderStage, payment: PaymentView | null): OrderPaymentState {
  return {
    orderStage,
    payment,
    canCreatePayment:
      orderStage === 'AWAITING_PAYMENT' && (!payment || RETRYABLE_ATTEMPTS.has(payment.status)),
  };
}

export const paymentsService = {
  async state(access: OrderAccess): Promise<OrderPaymentState> {
    const [order, payment] = await Promise.all([
      apiGet<GuestOrderTrackingView>(orderPath(access)),
      latestPayment(access),
    ]);
    return toState(order.stage, payment);
  },

  /** The gateway returns codes only; the code stands in for the name until the API sends one. */
  async methods(): Promise<PaymentMethod[]> {
    const { methods } = await apiGet<PaymentMethodsView>('/payments/methods');
    return methods.map(({ code }) => ({ id: code, name: code, available: true }));
  },

  /** The body names the method only; the API charges the order total it stored. */
  async create(access: OrderAccess, request: CreatePaymentRequest, idempotencyKey: string) {
    await apiSend<PaymentView>('POST', `${orderPath(access)}/payment`, request, {
      'Idempotency-Key': idempotencyKey,
    });
    return paymentsService.state(access);
  },
};
