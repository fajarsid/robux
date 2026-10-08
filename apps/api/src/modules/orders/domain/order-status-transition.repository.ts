import type { ActorType, OrderCancelReason, OrderStatus } from '../../../generated/prisma/enums';

export interface OrderStatusTransition {
  orderId: string;
  from: OrderStatus;
  to: OrderStatus;
  actorType: ActorType;
  actorUserId?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
  requestId?: string;
  /** Required when `to` is CANCELLED (database CHECK). */
  cancelReason?: OrderCancelReason;
  /** Announced through the outbox in the same transaction (ids only, never tokens or secrets). */
  outboxEventType?: string;
}

export type OrderStatusTransitionResult =
  { applied: true } | { applied: false; reason: 'STATUS_CHANGED_CONCURRENTLY' };

export interface OrderLifecycleState {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  userId: string | null;
}

export interface OrderStatusTransitionRepository {
  /**
   * Applies `from → to` only if the order is still in `from`, recording history (and the outbox
   * event, if any) in the same transaction. Whether `from → to` is allowed is decided by the
   * domain state machine before calling this.
   */
  apply(transition: OrderStatusTransition): Promise<OrderStatusTransitionResult>;
  findState(orderId: string): Promise<OrderLifecycleState | null>;
  findStateByTrackingTokenHash(tokenHash: string): Promise<OrderLifecycleState | null>;
  /** PAYMENT_PENDING orders whose payment deadline has passed, oldest first. */
  dueForPaymentExpiry(now: Date, limit: number): Promise<OrderLifecycleState[]>;
}

export const ORDER_STATUS_TRANSITION_REPOSITORY = Symbol('ORDER_STATUS_TRANSITION_REPOSITORY');
