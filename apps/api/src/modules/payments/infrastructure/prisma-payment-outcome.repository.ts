import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import type { Prisma } from '../../../generated/prisma/client';
import type { PaymentStatus } from '../../../generated/prisma/enums';
import { OrderEvent } from '../../orders/domain/order-events';
import { writeOrderTransition } from '../../orders/infrastructure/order-transition.writer';
import type { PaymentDecision } from '../domain/payment-assessment';
import type {
  ApplyPaymentDecision,
  PaymentDecisionOutcome,
  PaymentOutcomeRepository,
} from '../domain/payment-outcome.repository';
import { isUniqueViolation } from './prisma-payment.repository';

type Tx = Prisma.TransactionClient;
type ReconcileReason = 'PAYMENT_AMOUNT_MISMATCH' | 'PAYMENT_STATUS_MISMATCH';

/** Applies verified gateway decisions; all writes of one decision share one transaction. */
@Injectable()
export class PrismaPaymentOutcomeRepository implements PaymentOutcomeRepository {
  constructor(private readonly prisma: PrismaService) {}

  async applyDecision(input: ApplyPaymentDecision): Promise<PaymentDecisionOutcome> {
    try {
      return await this.prisma.$transaction((tx) => this.applyInTransaction(tx, input));
    } catch (error) {
      // Two different attempts of one order confirmed at the same instant: the partial unique
      // index "one PAID per order" rejected the second. Re-run so it sees the first and records
      // a duplicate payment instead.
      if (isUniqueViolation(error) && input.decision.kind === 'CONFIRM_PAID') {
        return this.prisma.$transaction((tx) => this.applyInTransaction(tx, input));
      }
      throw error;
    }
  }

  private async applyInTransaction(
    tx: Tx,
    input: ApplyPaymentDecision,
  ): Promise<PaymentDecisionOutcome> {
    const { payment, decision, now } = input;
    // Row lock: concurrent deliveries of the same callback are applied one after the other.
    const [locked] = await tx.$queryRaw<{ status: PaymentStatus }[]>`
      SELECT status FROM payments WHERE id = ${payment.id}::uuid FOR UPDATE`;
    if (!locked) {
      throw new Error(`Payment ${payment.id} disappeared`);
    }
    const verification = {
      rawStatus: decision.rawStatus,
      lastVerifiedAt: now,
      ...(input.trigger === 'CALLBACK' ? { callbackCount: { increment: 1 } } : {}),
    };

    switch (decision.kind) {
      case 'CONFIRM_PAID':
        return this.confirmPaid(tx, input, locked.status, decision, verification);
      case 'RECONCILE': {
        await tx.payment.update({ where: { id: payment.id }, data: verification });
        if (locked.status === 'PENDING') {
          await writeOrderTransition(tx, {
            orderId: payment.orderId,
            from: 'PAYMENT_PENDING',
            to: 'RECONCILIATION_REQUIRED',
            actorType: 'PAYMENT_GATEWAY',
            reason: 'Data pembayaran dari gateway tidak cocok',
            metadata: { paymentId: payment.id, reconciliationKind: decision.reconciliationKind },
            requestId: input.requestId,
          });
        }
        await this.openReconciliationCase(
          tx,
          input,
          decision.reconciliationKind,
          decision.evidence,
        );
        return 'RECONCILIATION_OPENED';
      }
      case 'CLOSE': {
        const { count } = await tx.payment.updateMany({
          where: { id: payment.id, status: 'PENDING' },
          data: { ...verification, status: decision.status },
        });
        if (count === 0) {
          await tx.payment.update({ where: { id: payment.id }, data: verification });
          return 'UNCHANGED';
        }
        return 'CLOSED';
      }
      case 'STILL_PENDING':
        await tx.payment.update({ where: { id: payment.id }, data: verification });
        return 'UNCHANGED';
    }
  }

  private async confirmPaid(
    tx: Tx,
    input: ApplyPaymentDecision,
    currentStatus: PaymentStatus,
    decision: Extract<PaymentDecision, { kind: 'CONFIRM_PAID' }>,
    verification: Prisma.PaymentUpdateInput,
  ): Promise<PaymentDecisionOutcome> {
    const { payment, now } = input;
    if (currentStatus === 'PAID') {
      await tx.payment.update({ where: { id: payment.id }, data: verification });
      return 'ALREADY_PAID';
    }
    const otherPaid = await tx.payment.findFirst({
      where: { orderId: payment.orderId, status: 'PAID', id: { not: payment.id } },
      select: { id: true },
    });
    if (otherPaid) {
      await tx.payment.update({
        where: { id: payment.id },
        data: { ...verification, gatewayReference: decision.gatewayReference },
      });
      await this.openReconciliationCase(tx, input, 'PAYMENT_STATUS_MISMATCH', {
        reason: 'DUPLICATE_PAYMENT',
        paidPaymentId: otherPaid.id,
        gatewayReference: decision.gatewayReference,
      });
      return 'DUPLICATE_PAYMENT';
    }

    // Money was taken, so the payment is PAID whatever happened to the order meanwhile.
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        ...verification,
        status: 'PAID',
        paidAt: now,
        gatewayReference: decision.gatewayReference,
        ...(input.paymentMethod ? { paymentMethodCode: input.paymentMethod } : {}),
      },
    });
    const orderPaid = await writeOrderTransition(tx, {
      orderId: payment.orderId,
      from: 'PAYMENT_PENDING',
      to: 'PAID',
      actorType: 'PAYMENT_GATEWAY',
      reason: 'Pembayaran terverifikasi',
      metadata: {
        paymentId: payment.id,
        gateway: payment.gateway,
        gatewayReference: decision.gatewayReference,
      },
      requestId: input.requestId,
      outboxEventType: OrderEvent.PAYMENT_CONFIRMED,
    });
    if (orderPaid) {
      return 'CONFIRMED';
    }
    await this.openReconciliationCase(tx, input, 'PAYMENT_STATUS_MISMATCH', {
      reason: 'ORDER_NOT_AWAITING_PAYMENT',
      gatewayReference: decision.gatewayReference,
    });
    return 'PAID_FOR_CLOSED_ORDER';
  }

  /** One OPEN case per order and kind (partial unique index); an alert event only for a new case. */
  private async openReconciliationCase(
    tx: Tx,
    input: ApplyPaymentDecision,
    kind: ReconcileReason,
    evidence: Record<string, unknown>,
  ): Promise<void> {
    const { count } = await tx.reconciliationCase.createMany({
      data: {
        orderId: input.payment.orderId,
        paymentId: input.payment.id,
        kind,
        evidence: evidence as Prisma.InputJsonValue,
      },
      skipDuplicates: true,
    });
    if (count === 1) {
      await tx.outboxEvent.create({
        data: {
          aggregateType: 'payment',
          aggregateId: input.payment.id,
          eventType: 'PAYMENT_RECONCILIATION_REQUIRED',
          payload: { paymentId: input.payment.id, orderId: input.payment.orderId, kind },
          requestId: input.requestId,
        },
      });
    }
  }
}
