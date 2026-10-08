import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import type {
  OrderLifecycleState,
  OrderStatusTransition,
  OrderStatusTransitionRepository,
  OrderStatusTransitionResult,
} from '../domain/order-status-transition.repository';
import { writeOrderTransition } from './order-transition.writer';

const STATE_SELECT = { id: true, orderNumber: true, status: true, userId: true } as const;

@Injectable()
export class PrismaOrderStatusTransitionRepository implements OrderStatusTransitionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async apply(transition: OrderStatusTransition): Promise<OrderStatusTransitionResult> {
    // Every status change goes through the writer, so the transition table cannot be bypassed.
    const applied = await this.prisma.$transaction((tx) => writeOrderTransition(tx, transition));
    return applied
      ? ({ applied: true } as const)
      : ({ applied: false, reason: 'STATUS_CHANGED_CONCURRENTLY' } as const);
  }

  findState(orderId: string): Promise<OrderLifecycleState | null> {
    return this.prisma.order.findUnique({ where: { id: orderId }, select: STATE_SELECT });
  }

  findStateByTrackingTokenHash(tokenHash: string): Promise<OrderLifecycleState | null> {
    return this.prisma.order.findUnique({
      where: { trackingTokenHash: tokenHash },
      select: STATE_SELECT,
    });
  }

  dueForPaymentExpiry(now: Date, limit: number): Promise<OrderLifecycleState[]> {
    return this.prisma.order.findMany({
      where: { status: 'PAYMENT_PENDING', paymentExpiresAt: { lte: now } },
      select: STATE_SELECT,
      orderBy: { paymentExpiresAt: 'asc' },
      take: limit,
    });
  }
}
