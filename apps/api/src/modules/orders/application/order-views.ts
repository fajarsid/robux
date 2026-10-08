import type {
  AdminOrderView,
  GuestOrderTrackingView,
  PriceBreakdownView,
  ProductFulfillmentView,
} from '@robux/shared';
import { productLineProfile } from '../../products/domain/product-line';
import type { OrderReadModel } from '../domain/order-read.repository';
import { isCancellable } from '../domain/order-state-machine';
import { toPublicOrderStage, toPublicTimeline } from '../domain/public-order-stage';

/** Orders hold one item today; the breakdown mirrors the stored snapshot, never a recomputation. */
function pricingOf(order: OrderReadModel): PriceBreakdownView {
  const item = order.items[0];
  return {
    currency: order.currency,
    unitPrice: item?.unitPrice ?? order.subtotal,
    quantity: item?.quantity ?? 1,
    subtotal: order.subtotal,
    discount: order.discount,
    fee: order.fee,
    tax: order.tax,
    total: order.total,
  };
}

/** From the order's own snapshot, never from the product as it is configured today. */
function fulfillmentOf(order: OrderReadModel): ProductFulfillmentView {
  return {
    productLine: order.productLine,
    platform: order.platform,
    fulfillmentType: order.fulfillmentType,
    recipientType: order.recipientType,
    unit: productLineProfile(order.productLine).unit,
  };
}

/** Customer-safe view: no internal ids, contact details, provider data or staff notes. */
export function toTrackingView(order: OrderReadModel): GuestOrderTrackingView {
  return {
    orderNumber: order.orderNumber,
    stage: toPublicOrderStage(order.status),
    currency: order.currency,
    total: order.total,
    ...fulfillmentOf(order),
    recipientUsername: order.recipientUsername,
    items: publicItems(order),
    timeline: toPublicTimeline(order.history),
    createdAt: order.createdAt.toISOString(),
    pricing: pricingOf(order),
    paymentExpiresAt: order.paymentExpiresAt?.toISOString() ?? null,
    cancellable: isCancellable(order.status),
  };
}

export function toAdminOrderView(order: OrderReadModel): AdminOrderView {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    stage: toPublicOrderStage(order.status),
    customer: {
      userId: order.userId,
      contactEmail: order.contactEmail,
      guest: order.userId === null,
    },
    ...fulfillmentOf(order),
    recipientUsername: order.recipientUsername,
    recipientRobloxUserId: order.recipientRobloxUserId,
    pricing: pricingOf(order),
    items: publicItems(order),
    history: order.history.map((entry) => ({
      fromStatus: entry.fromStatus,
      toStatus: entry.toStatus,
      actorType: entry.actorType,
      reason: entry.reason,
      at: entry.createdAt.toISOString(),
    })),
    cancelReason: order.cancelReason,
    paymentExpiresAt: order.paymentExpiresAt?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
  };
}

/** Provider settlement quotes belong to payment verification and are not part of an order view. */
function publicItems(order: OrderReadModel) {
  return order.items.map((item) => {
    const safe = { ...item };
    delete safe.starsAmountSnapshot;
    return safe;
  });
}
