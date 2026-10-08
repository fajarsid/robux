import type {
  FulfillmentMethodName,
  FulfillmentTypeName,
  PlatformName,
  ProductLineName,
  RecipientTypeName,
} from '@robux/shared';
import type Decimal from 'decimal.js';
import type { ActorType } from '../../../generated/prisma/enums';

export interface NewOrder {
  orderNumber: string;
  trackingTokenHash: string;
  userId: string | null;
  contactEmail: string;
  /** Null for digital delivery. */
  recipient: { type: RecipientTypeName; identifier: string } | null;
  currency: string;
  fulfillmentMethod: FulfillmentMethodName;
  /** Snapshot of the product line and what it implied at purchase (ADR-009). */
  productLine: ProductLineName;
  platform: PlatformName;
  fulfillmentType: FulfillmentTypeName;
  subtotal: Decimal;
  discount: Decimal;
  fee: Decimal;
  tax: Decimal;
  total: Decimal;
  paymentExpiresAt: Date;
  item: {
    productId: string;
    productPriceId: string;
    productName: string;
    robuxAmount: number;
    quantity: number;
    unitPrice: Decimal;
    unitCost: Decimal;
    lineSubtotal: Decimal;
    starsAmountSnapshot?: number | null;
  };
  idempotency: {
    scope: string;
    key: string;
    requestHash: string;
    expiresAt: Date;
    /** The response to replay for this key (sensitive parts already encrypted). */
    response: Record<string, unknown>;
  };
  actorType: ActorType;
  actorUserId?: string;
  requestId?: string;
}

export interface StoredIdempotentResponse {
  requestHash: string;
  response: Record<string, unknown>;
  /** The order created for this key. */
  orderId: string | null;
}

/** Raised when the idempotency key was taken concurrently; the caller replays the stored result. */
export class IdempotencyKeyTaken extends Error {
  constructor() {
    super('Idempotency key already used');
    this.name = 'IdempotencyKeyTaken';
  }
}

export interface OrderCreationRepository {
  /**
   * In one transaction: order (CREATED) with its item snapshot, history NULL → CREATED and
   * CREATED → PAYMENT_PENDING, the ORDER_CREATED outbox event and the idempotency record.
   * Throws IdempotencyKeyTaken if a concurrent request with the same key committed first.
   */
  create(order: NewOrder): Promise<{ orderId: string }>;
  findIdempotentResponse(scope: string, key: string): Promise<StoredIdempotentResponse | null>;
}

export const ORDER_CREATION_REPOSITORY = Symbol('ORDER_CREATION_REPOSITORY');
