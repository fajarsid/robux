import type { CreateOrderRequest, OrderCreatedView } from '@robux/shared';
import { apiSend } from '@/lib/api/browser-api';

export const checkoutService = {
  /** The body carries no prices; the API prices the order and returns the snapshot. */
  placeOrder: (request: CreateOrderRequest, idempotencyKey: string) =>
    apiSend<OrderCreatedView>('POST', '/orders', request, { 'Idempotency-Key': idempotencyKey }),
};
