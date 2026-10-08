import type { PaymentView, PublicOrderStage } from '@robux/shared';

/**
 * A method as the payment UI shows it. The API currently returns only the gateway `code`; the
 * service maps it here so components never depend on the gateway's naming.
 */
export interface PaymentMethod {
  id: string;
  name: string;
  category?: string;
  icon?: string;
  available: boolean;
}

/** What the payment page renders: the order stage and the latest attempt, both from the API. */
export interface OrderPaymentState {
  orderStage: PublicOrderStage;
  payment: PaymentView | null;
  canCreatePayment: boolean;
}

/** How the visitor proves access to the order: the guest tracking token or the signed-in owner. */
export type OrderAccess =
  { kind: 'guest'; trackingToken: string } | { kind: 'customer'; orderId: string };
