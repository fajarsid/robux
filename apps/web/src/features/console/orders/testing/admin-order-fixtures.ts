import type { AdminOrderView } from '@robux/shared';
import type { AdminOrderListView, AdminOrderSummaryView } from '../types/admin-orders';

export const ORDER_ID = '0192f0a0-0000-7000-8000-0000000000aa';

export function adminOrder(overrides: Partial<AdminOrderView> = {}): AdminOrderView {
  return {
    id: ORDER_ID,
    orderNumber: 'RBX-20261005-00001',
    status: 'PAYMENT_PENDING',
    stage: 'AWAITING_PAYMENT',
    customer: { userId: null, contactEmail: 'guest@example.test', guest: true },
    recipientUsername: 'Builder_Kid',
    productLine: 'ROBLOX_ROBUX',
    platform: 'ROBLOX',
    fulfillmentType: 'BALANCE_PURCHASE',
    recipientType: 'ROBLOX_USER',
    unit: 'ROBUX',
    recipientRobloxUserId: null,
    pricing: {
      currency: 'IDR',
      unitPrice: '24500.00',
      quantity: 2,
      subtotal: '49000.00',
      discount: '1000.00',
      fee: '2000.00',
      tax: '3000.00',
      total: '53000.00',
    },
    items: [
      {
        productName: 'Robux 500',
        robuxAmount: 500,
        quantity: 2,
        unitPrice: '24500.00',
        lineSubtotal: '49000.00',
      },
    ],
    history: [
      {
        fromStatus: null,
        toStatus: 'CREATED',
        actorType: 'CUSTOMER',
        reason: null,
        at: '2026-10-05T03:00:00.000Z',
      },
      {
        fromStatus: 'CREATED',
        toStatus: 'PAYMENT_PENDING',
        actorType: 'SYSTEM',
        reason: null,
        at: '2026-10-05T03:00:01.000Z',
      },
    ],
    cancelReason: null,
    paymentExpiresAt: '2026-10-05T04:00:00.000Z',
    createdAt: '2026-10-05T03:00:00.000Z',
    ...overrides,
  };
}

export function orderSummary(
  overrides: Partial<AdminOrderSummaryView> = {},
): AdminOrderSummaryView {
  return {
    id: ORDER_ID,
    orderNumber: 'RBX-20261005-00001',
    status: 'PAYMENT_PENDING',
    stage: 'AWAITING_PAYMENT',
    customer: { contactEmail: 'guest@example.test', guest: true },
    productName: 'Robux 500',
    robuxAmount: 500,
    quantity: 2,
    fulfillmentMethod: 'INSTANT',
    currency: 'IDR',
    total: '53000.00',
    paymentStatus: null,
    createdAt: '2026-10-05T03:00:00.000Z',
    ...overrides,
  };
}

export function orderList(overrides: Partial<AdminOrderListView> = {}): AdminOrderListView {
  return { items: [orderSummary()], page: 1, pageSize: 20, total: 1, ...overrides };
}
