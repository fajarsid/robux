import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import type { GatewayPaymentCreated } from '../domain/payment-gateway';
import {
  type NewPaymentAttempt,
  PaymentAttemptConflict,
  type PaymentIdempotencyRecord,
  type PaymentRecord,
  type PaymentRepository,
} from '../domain/payment.repository';

type PaymentRow = Prisma.PaymentGetPayload<object>;

export const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

function toRecord(row: PaymentRow): PaymentRecord {
  return {
    id: row.id,
    orderId: row.orderId,
    gateway: row.gateway,
    merchantOrderId: row.merchantOrderId,
    gatewayReference: row.gatewayReference,
    paymentMethod: row.paymentMethodCode,
    amount: row.amount.toFixed(2),
    currency: row.currency,
    status: row.status,
    paymentUrl: row.paymentUrl,
    qrPayload: row.qrPayload,
    expiresAt: row.expiresAt,
    paidAt: row.paidAt,
    createdAt: row.createdAt,
  };
}

@Injectable()
export class PrismaPaymentRepository implements PaymentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async latestForOrder(orderId: string): Promise<PaymentRecord | null> {
    const row = await this.prisma.payment.findFirst({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
    });
    return row && toRecord(row);
  }

  async findOpenAttempt(orderId: string): Promise<PaymentRecord | null> {
    const row = await this.prisma.payment.findFirst({ where: { orderId, status: 'PENDING' } });
    return row && toRecord(row);
  }

  countAttempts(orderId: string): Promise<number> {
    return this.prisma.payment.count({ where: { orderId } });
  }

  async findByMerchantOrderId(merchantOrderId: string): Promise<PaymentRecord | null> {
    const row = await this.prisma.payment.findUnique({ where: { merchantOrderId } });
    return row && toRecord(row);
  }

  async openAttempt(attempt: NewPaymentAttempt): Promise<PaymentRecord> {
    try {
      const row = await this.prisma.payment.create({
        data: {
          orderId: attempt.orderId,
          gateway: attempt.gateway,
          merchantOrderId: attempt.merchantOrderId,
          paymentMethodCode: attempt.paymentMethod,
          amount: attempt.amount,
          currency: attempt.currency as 'IDR' | 'XTR',
          status: 'PENDING',
        },
      });
      return toRecord(row);
    } catch (error) {
      // Partial unique "one PENDING per order" or the attempt number taken by a concurrent request.
      if (isUniqueViolation(error)) {
        throw new PaymentAttemptConflict();
      }
      throw error;
    }
  }

  async recordGatewayAcceptance(
    paymentId: string,
    created: GatewayPaymentCreated,
    idempotency: PaymentIdempotencyRecord,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: paymentId },
        data: {
          ...(created.gatewayReference !== null
            ? { gatewayReference: created.gatewayReference }
            : {}),
          paymentUrl: created.paymentUrl,
          qrPayload: created.qrPayload ?? null,
          expiresAt: created.expiresAt,
        },
      });
      await tx.idempotencyKey.createMany({
        data: {
          scope: idempotency.scope,
          key: idempotency.key,
          requestHash: idempotency.requestHash,
          status: 'COMPLETED',
          responseStatus: 201,
          responseBody: idempotency.response as Prisma.InputJsonValue,
          resourceId: paymentId,
          expiresAt: idempotency.expiresAt,
        },
        skipDuplicates: true,
      });
    });
  }

  async closeAttempt(
    paymentId: string,
    status: 'FAILED' | 'EXPIRED',
    rawStatus: string,
  ): Promise<boolean> {
    const { count } = await this.prisma.payment.updateMany({
      where: { id: paymentId, status: 'PENDING' },
      data: { status, rawStatus },
    });
    return count === 1;
  }

  async findIdempotentResponse(scope: string, key: string) {
    const row = await this.prisma.idempotencyKey.findUnique({
      where: { scope_key: { scope, key } },
      select: { requestHash: true, responseBody: true, status: true },
    });
    if (!row || row.status !== 'COMPLETED' || !row.responseBody) {
      return null;
    }
    return { requestHash: row.requestHash, response: row.responseBody as Record<string, unknown> };
  }
}
