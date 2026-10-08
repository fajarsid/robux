import { z } from 'zod';
import type {
  FulfillmentMethodName,
  PriceBreakdownView,
  ProductFulfillmentView,
  RecipientTypeName,
} from './catalog';
import type { PaymentStatusView } from './payments';

/** Customer-facing order stages. Internal statuses are mapped to these by the API only. */
export type PublicOrderStage =
  'AWAITING_PAYMENT' | 'PROCESSING' | 'COMPLETED' | 'CANCELLED' | 'REFUND_IN_PROGRESS' | 'REFUNDED';

export interface OrderItemView {
  productName: string;
  robuxAmount: number;
  quantity: number;
  unitPrice: string;
  lineSubtotal: string;
}

export interface OrderTimelineEntry {
  stage: PublicOrderStage;
  at: string;
}

/** Public tracking view: no internal ids, provider details, payment data or staff notes. */
export interface GuestOrderTrackingView extends OrderPricingView, ProductFulfillmentView {
  orderNumber: string;
  stage: PublicOrderStage;
  currency: string;
  total: string;
  /** Null for digital delivery, which has no recipient. */
  recipientUsername: string | null;
  recipientType: RecipientTypeName | null;
  items: OrderItemView[];
  timeline: OrderTimelineEntry[];
  createdAt: string;
}

export interface CustomerOrderSummaryView {
  id: string;
  orderNumber: string;
  stage: PublicOrderStage;
  currency: string;
  total: string;
  totalRobux: number;
  createdAt: string;
}

export interface CustomerOrderDetailView extends GuestOrderTrackingView {
  id: string;
}

/**
 * Roblox username format as a first gate only (3 to 20 letters, digits or one underscore, not at
 * the start or end). The account itself is resolved against Roblox in Phase 11.
 */
export const robloxUsernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(20)
  .regex(/^[A-Za-z0-9]+(_[A-Za-z0-9]+)?$/);

/**
 * Telegram username format as a first gate only: 5 to 32 letters, digits or underscores, starting
 * with a letter; a leading "@" is accepted and removed. The provider validates the account.
 */
export const telegramUsernameSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/^@/, ''))
  .pipe(
    z
      .string()
      .min(5)
      .max(32)
      .regex(/^[A-Za-z][A-Za-z0-9_]*$/),
  );

/**
 * Who receives the order. The kind must match the product: the API decides which kind a product
 * needs (or that it needs none, for digital delivery) and refuses anything else.
 */
export const orderRecipientSchema = z.union([
  z.strictObject({ robloxUsername: robloxUsernameSchema }),
  z.strictObject({ telegramUsername: telegramUsernameSchema }),
]);

/**
 * What the browser may send. Prices and totals are never accepted: unknown fields such as a
 * client total are rejected. `priceVersionId` is the price the customer saw; if it is no longer
 * the price in force the API answers PRICE_CHANGED instead of charging a different amount.
 */
export const createOrderRequestSchema = z.strictObject({
  productId: z.uuid(),
  quantity: z.number().int().min(1).max(100),
  priceVersionId: z.uuid(),
  /** Required unless the product is delivered from inventory (digital delivery). */
  recipient: orderRecipientSchema.optional(),
  /** Required for guests; signed-in customers use their account email. */
  contactEmail: z
    .string()
    .trim()
    .max(254)
    .pipe(z.email())
    .transform((value) => value.toLowerCase())
    .optional(),
});

export type CreateOrderRequest = z.infer<typeof createOrderRequestSchema>;

/** Client-generated, high-entropy key; a retry with the same key returns the same order. */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export const cancelOrderRequestSchema = z.strictObject({
  reason: z.string().trim().min(3).max(500),
});

export interface OrderCreatedView {
  orderNumber: string;
  /** Shown once to guests and signed-in customers alike; the private link to follow the order. */
  trackingToken: string;
  stage: PublicOrderStage;
  pricing: PriceBreakdownView;
  recipientUsername: string | null;
  paymentExpiresAt: string | null;
  /** Present for signed-in customers. */
  orderId?: string;
}

export interface OrderPricingView {
  pricing: PriceBreakdownView;
  paymentExpiresAt: string | null;
  cancellable: boolean;
}

/** Mirrors the `order_status` database enum (kept equal by an API unit test). Staff views only. */
export const ORDER_STATUSES = [
  'CREATED',
  'PAYMENT_PENDING',
  'PAID',
  'QUEUED',
  'PROCESSING',
  'FULFILLMENT_PENDING',
  'FULFILLED',
  'FAILED',
  'RETRYING',
  'FAILED_PERMANENTLY',
  'PARTIALLY_FULFILLED',
  'RECONCILIATION_REQUIRED',
  'CANCELLED',
  'REFUND_PENDING',
  'REFUNDED',
] as const;

export type OrderStatusName = (typeof ORDER_STATUSES)[number];

/** Query parameters of `GET /api/v1/admin/orders` (staff order list, PRD §34). */
export interface AdminOrderListQuery {
  /** Order number or customer email. */
  q?: string;
  status?: OrderStatusName;
  paymentStatus?: PaymentStatusView;
  /** Inclusive calendar dates (YYYY-MM-DD, Asia/Jakarta). */
  createdFrom?: string;
  createdTo?: string;
  page: number;
  pageSize: number;
}

/** One row of the staff order list. The API endpoint is not implemented yet; the UI is built on this contract. */
export interface AdminOrderSummaryView {
  id: string;
  orderNumber: string;
  status: OrderStatusName;
  stage: PublicOrderStage;
  customer: { contactEmail: string; guest: boolean };
  productName: string;
  robuxAmount: number;
  quantity: number;
  fulfillmentMethod: FulfillmentMethodName;
  currency: string;
  total: string;
  /** Latest payment attempt; null while no payment has been started. */
  paymentStatus: PaymentStatusView | null;
  createdAt: string;
}

export interface AdminOrderListView {
  items: AdminOrderSummaryView[];
  page: number;
  pageSize: number;
  total: number;
}

/** Staff view of one order (orders.read.any): internal status and full history. */
export interface AdminOrderView extends ProductFulfillmentView {
  id: string;
  orderNumber: string;
  status: string;
  stage: PublicOrderStage;
  customer: { userId: string | null; contactEmail: string; guest: boolean };
  recipientUsername: string | null;
  recipientType: RecipientTypeName | null;
  recipientRobloxUserId: string | null;
  pricing: PriceBreakdownView;
  items: OrderItemView[];
  history: {
    fromStatus: string | null;
    toStatus: string;
    actorType: string;
    reason: string | null;
    at: string;
  }[];
  cancelReason: string | null;
  paymentExpiresAt: string | null;
  createdAt: string;
}
