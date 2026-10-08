import { Inject, Injectable } from '@nestjs/common';
import { ErrorCode } from '@robux/shared';
import { DomainError } from '../../../common/errors/domain-error';
import type { RequestContext } from '../../../common/http/request-context';
import type { ActorType, OrderCancelReason } from '../../../generated/prisma/enums';
import { RecordAuditEventService } from '../../audit/application/record-audit-event.service';
import type { AuthenticatedPrincipal } from '../../auth/domain/authenticated-principal';
import {
  hashGuestTrackingToken,
  isWellFormedGuestTrackingToken,
} from '../domain/guest-tracking-token';
import { isCancellable } from '../domain/order-state-machine';
import {
  ORDER_STATUS_TRANSITION_REPOSITORY,
  type OrderLifecycleState,
  type OrderStatusTransitionRepository,
} from '../domain/order-status-transition.repository';

const orderNotFound = () => new DomainError(ErrorCode.ORDER_NOT_FOUND, 'Pesanan tidak ditemukan.');

interface Cancellation {
  actorType: ActorType;
  actorUserId?: string;
  cancelReason: OrderCancelReason;
  reason: string;
  requestId?: string;
}

export type CancellationOutcome = 'CANCELLED' | 'ALREADY_CANCELLED';

/**
 * Cancellation before payment only (CREATED, PAYMENT_PENDING). Cancelling an already cancelled
 * order succeeds without a second history row; any other state is ORDER_NOT_CANCELLABLE.
 */
@Injectable()
export class CancelOrderService {
  constructor(
    @Inject(ORDER_STATUS_TRANSITION_REPOSITORY)
    private readonly orders: OrderStatusTransitionRepository,
    private readonly audit: RecordAuditEventService,
  ) {}

  async cancelOwn(principal: AuthenticatedPrincipal, orderId: string, context: RequestContext) {
    const order = await this.orders.findState(orderId);
    if (!order || order.userId !== principal.userId) {
      throw orderNotFound();
    }
    return this.cancel(order, {
      actorType: 'CUSTOMER',
      actorUserId: principal.userId,
      cancelReason: 'CUSTOMER_REQUEST',
      reason: 'Dibatalkan oleh pelanggan',
      requestId: context.requestId,
    });
  }

  async cancelByTrackingToken(token: string, context: RequestContext) {
    const order = isWellFormedGuestTrackingToken(token)
      ? await this.orders.findStateByTrackingTokenHash(hashGuestTrackingToken(token))
      : null;
    if (!order) {
      throw orderNotFound();
    }
    return this.cancel(order, {
      actorType: 'CUSTOMER',
      cancelReason: 'CUSTOMER_REQUEST',
      reason: 'Dibatalkan melalui tautan pelacakan',
      requestId: context.requestId,
    });
  }

  async cancelAsStaff(
    principal: AuthenticatedPrincipal,
    orderId: string,
    reason: string,
    context: RequestContext,
  ): Promise<CancellationOutcome> {
    const order = await this.orders.findState(orderId);
    if (!order) {
      throw orderNotFound();
    }
    const outcome = await this.cancel(order, {
      actorType: 'STAFF',
      actorUserId: principal.userId,
      cancelReason: 'STAFF_ACTION',
      reason,
      requestId: context.requestId,
    });
    if (outcome === 'CANCELLED') {
      await this.audit.record({
        action: 'ORDER_CANCEL',
        result: 'SUCCESS',
        actorType: 'STAFF',
        actorUserId: principal.userId,
        actorRole: principal.role,
        resourceType: 'order',
        resourceId: order.id,
        before: { status: order.status },
        after: { status: 'CANCELLED', cancelReason: 'STAFF_ACTION' },
        reason,
        ipAddress: context.ipAddress,
        requestId: context.requestId,
      });
    }
    return outcome;
  }

  private async cancel(
    order: OrderLifecycleState,
    cancellation: Cancellation,
  ): Promise<CancellationOutcome> {
    if (order.status === 'CANCELLED') {
      return 'ALREADY_CANCELLED';
    }
    if (!isCancellable(order.status)) {
      throw new DomainError(
        ErrorCode.ORDER_NOT_CANCELLABLE,
        'Pesanan ini tidak dapat dibatalkan pada status saat ini.',
      );
    }
    const result = await this.orders.apply({
      orderId: order.id,
      from: order.status,
      to: 'CANCELLED',
      ...cancellation,
      outboxEventType: 'ORDER_CANCELLED',
    });
    if (result.applied) {
      return 'CANCELLED';
    }
    // Someone else moved the order first: decide again on its current state.
    const current = await this.orders.findState(order.id);
    if (current?.status === 'CANCELLED') {
      return 'ALREADY_CANCELLED';
    }
    throw new DomainError(
      ErrorCode.ORDER_NOT_CANCELLABLE,
      'Status pesanan berubah. Pesanan ini tidak dapat dibatalkan lagi.',
    );
  }
}
