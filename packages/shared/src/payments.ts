import { z } from 'zod';

/**
 * Payment method codes are gateway codes (two characters for Duitku). The browser only picks one
 * of the codes returned by GET /payments/methods; the API re-checks it against its own list.
 */
export const paymentMethodCodeSchema = z.string().regex(/^(?:[A-Z0-9]{2}|TELEGRAM_STARS)$/);

/** What the browser may send to start paying an order. The amount is never accepted. */
export const createPaymentRequestSchema = z.strictObject({
  paymentMethod: paymentMethodCodeSchema,
});

export type CreatePaymentRequest = z.infer<typeof createPaymentRequestSchema>;

/** Mirrors the `payment_status` database enum (kept equal by an API unit test). */
export const PAYMENT_STATUSES = [
  'PENDING',
  'PAID',
  'EXPIRED',
  'FAILED',
  'CANCELLED',
  'REFUND_PENDING',
  'REFUNDED',
] as const;

export type PaymentStatusView = (typeof PAYMENT_STATUSES)[number];

export interface PaymentMethodView {
  code: string;
}

export interface PaymentMethodsView {
  methods: PaymentMethodView[];
}

/**
 * The latest payment attempt of an order. `paymentUrl` is set only while the attempt can still be
 * paid; the customer is redirected there. No gateway references or internal ids are exposed.
 */
export interface PaymentView {
  status: PaymentStatusView;
  paymentMethod: string | null;
  amount: string;
  currency: string;
  paymentUrl: string | null;
  paymentQrPayload?: string | null;
  expiresAt: string | null;
  paidAt: string | null;
}
