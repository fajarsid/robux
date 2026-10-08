import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import {
  IdempotencyKeyTaken,
  type NewOrder,
  type OrderCreationRepository,
  type StoredIdempotentResponse,
} from '../domain/order-creation.repository';
import { assertTransition } from '../domain/order-state-machine';

const money = (value: { toString(): string }) => value.toString();

@Injectable()
export class PrismaOrderCreationRepository implements OrderCreationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(order: NewOrder): Promise<{ orderId: string }> {
    const scopedKey = `${order.idempotency.scope}:${order.idempotency.key}`;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.order.create({
          data: {
            orderNumber: order.orderNumber,
            trackingTokenHash: order.trackingTokenHash,
            idempotencyKey: scopedKey,
            userId: order.userId,
            contactEmail: order.contactEmail,
            status: 'CREATED',
            fulfillmentMethod: order.fulfillmentMethod,
            productLine: order.productLine,
            platform: order.platform,
            fulfillmentType: order.fulfillmentType,
            currency: order.currency as 'IDR',
            subtotal: money(order.subtotal),
            discount: money(order.discount),
            fee: money(order.fee),
            tax: money(order.tax),
            total: money(order.total),
            recipientType: order.recipient?.type ?? null,
            recipientUsername: order.recipient?.identifier ?? null,
            paymentExpiresAt: order.paymentExpiresAt,
            items: {
              create: {
                productId: order.item.productId,
                productPriceId: order.item.productPriceId,
                productNameSnapshot: order.item.productName,
                robuxAmount: order.item.robuxAmount,
                quantity: order.item.quantity,
                currency: order.currency as 'IDR',
                unitPriceSnapshot: money(order.item.unitPrice),
                unitCostSnapshot: money(order.item.unitCost),
                starsAmountSnapshot: order.item.starsAmountSnapshot ?? null,
                lineSubtotal: money(order.item.lineSubtotal),
              },
            },
          },
          select: { id: true },
        });
        const history = {
          orderId: created.id,
          actorType: order.actorType,
          actorUserId: order.actorUserId,
          requestId: order.requestId,
        };
        await tx.orderStatusHistory.create({
          data: { ...history, fromStatus: null, toStatus: 'CREATED' },
        });
        assertTransition('CREATED', 'PAYMENT_PENDING');
        await tx.order.update({ where: { id: created.id }, data: { status: 'PAYMENT_PENDING' } });
        await tx.orderStatusHistory.create({
          data: { ...history, fromStatus: 'CREATED', toStatus: 'PAYMENT_PENDING' },
        });
        await tx.outboxEvent.create({
          data: {
            aggregateType: 'order',
            aggregateId: created.id,
            eventType: 'ORDER_CREATED',
            payload: { orderId: created.id, orderNumber: order.orderNumber },
            requestId: order.requestId,
          },
        });
        // Written last: a concurrent request with the same key blocks on this unique index until
        // the first transaction ends, then fails and replays the stored response.
        await tx.idempotencyKey.create({
          data: {
            scope: order.idempotency.scope,
            key: order.idempotency.key,
            requestHash: order.idempotency.requestHash,
            status: 'COMPLETED',
            responseStatus: 201,
            responseBody: order.idempotency.response as Prisma.InputJsonValue,
            resourceId: created.id,
            expiresAt: order.idempotency.expiresAt,
          },
        });
        return { orderId: created.id };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = JSON.stringify(error.meta ?? {});
        if (target.includes('idempotency')) {
          throw new IdempotencyKeyTaken();
        }
      }
      throw error;
    }
  }

  async findIdempotentResponse(
    scope: string,
    key: string,
  ): Promise<StoredIdempotentResponse | null> {
    const row = await this.prisma.idempotencyKey.findUnique({
      where: { scope_key: { scope, key } },
      select: { requestHash: true, responseBody: true, status: true, resourceId: true },
    });
    if (!row || row.status !== 'COMPLETED' || !row.responseBody) {
      return null;
    }
    return {
      requestHash: row.requestHash,
      response: row.responseBody as Record<string, unknown>,
      orderId: row.resourceId,
    };
  }
}
