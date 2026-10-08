import type { Prisma } from '../../../generated/prisma/client';
import { assertTransition } from '../domain/order-state-machine';
import type { OrderStatusTransition } from '../domain/order-status-transition.repository';

/**
 * The single write path for order status changes, usable inside a caller's transaction so a
 * payment and the order it pays change together (ARCHITECTURE.md §6.2). Returns false when the
 * order is no longer in `from`; then nothing (history, outbox) has been written.
 */
export async function writeOrderTransition(
  tx: Prisma.TransactionClient,
  transition: OrderStatusTransition,
): Promise<boolean> {
  assertTransition(transition.from, transition.to);
  const now = new Date();
  // Conditional update: if another writer moved the order first, zero rows match.
  const { count } = await tx.order.updateMany({
    where: { id: transition.orderId, status: transition.from },
    data: {
      status: transition.to,
      ...(transition.to === 'CANCELLED'
        ? { cancelReason: transition.cancelReason, cancelledAt: now }
        : {}),
      ...(transition.to === 'PAID' ? { paidAt: now } : {}),
      ...(transition.to === 'FULFILLED' ? { fulfilledAt: now } : {}),
    },
  });
  if (count === 0) {
    return false;
  }
  await tx.orderStatusHistory.create({
    data: {
      orderId: transition.orderId,
      fromStatus: transition.from,
      toStatus: transition.to,
      actorType: transition.actorType,
      actorUserId: transition.actorUserId,
      reason: transition.reason,
      metadata: transition.metadata as Prisma.InputJsonValue | undefined,
      requestId: transition.requestId,
    },
  });
  if (transition.outboxEventType) {
    await tx.outboxEvent.create({
      data: {
        aggregateType: 'order',
        aggregateId: transition.orderId,
        eventType: transition.outboxEventType,
        payload: { orderId: transition.orderId, from: transition.from, to: transition.to },
        requestId: transition.requestId,
      },
    });
  }
  return true;
}
