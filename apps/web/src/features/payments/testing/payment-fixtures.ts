import type { GuestOrderTrackingView, PaymentView } from '@robux/shared';
import type { OrderPaymentState, PaymentMethod } from '../types/payment.types';

/** Test data only. Shapes follow the shared payment contract; values are arbitrary. */
export const guestAccess = {
  kind: 'guest',
  trackingToken: 'tok_guestTrackingToken0123456789',
} as const;

export const methods: PaymentMethod[] = [
  { id: 'AA', name: 'AA', available: true },
  { id: 'BB', name: 'BB', available: false },
  { id: 'CC', name: 'CC', available: true },
];

export function payment(overrides: Partial<PaymentView> = {}): PaymentView {
  return {
    status: 'PENDING',
    paymentMethod: 'AA',
    amount: '49000.00',
    currency: 'IDR',
    paymentUrl: 'https://pay.example.test/session/abc',
    expiresAt: '2026-10-05T07:35:00.000Z',
    paidAt: null,
    ...overrides,
  };
}

export function paymentState(overrides: Partial<OrderPaymentState> = {}): OrderPaymentState {
  return {
    orderStage: 'AWAITING_PAYMENT',
    payment: payment(),
    canCreatePayment: false,
    ...overrides,
  };
}

export const order: GuestOrderTrackingView = {
  orderNumber: 'RBX-20261005-00001',
  stage: 'AWAITING_PAYMENT',
  currency: 'IDR',
  total: '49000.00',
  recipientUsername: 'Builder_Kid',
  productLine: 'ROBLOX_ROBUX',
  platform: 'ROBLOX',
  fulfillmentType: 'BALANCE_PURCHASE',
  recipientType: 'ROBLOX_USER',
  unit: 'ROBUX',
  items: [
    {
      productName: 'Robux 500',
      robuxAmount: 500,
      quantity: 1,
      unitPrice: '49000.00',
      lineSubtotal: '49000.00',
    },
  ],
  timeline: [{ stage: 'AWAITING_PAYMENT', at: '2026-10-05T07:00:00.000Z' }],
  createdAt: '2026-10-05T07:00:00.000Z',
  pricing: {
    quantity: 1,
    currency: 'IDR',
    unitPrice: '49000.00',
    subtotal: '49000.00',
    discount: '0.00',
    fee: '0.00',
    tax: '0.00',
    total: '49000.00',
  },
  paymentExpiresAt: '2026-10-05T08:00:00.000Z',
  cancellable: true,
};
