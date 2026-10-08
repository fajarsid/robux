import { Inject, Injectable } from '@nestjs/common';
import { ErrorCode } from '@robux/shared';
import { DomainError } from '../../../common/errors/domain-error';
import type { OrderStatus } from '../../../generated/prisma/enums';
import {
  hashGuestTrackingToken,
  isWellFormedGuestTrackingToken,
} from '../domain/guest-tracking-token';
import {
  ORDER_READ_REPOSITORY,
  type OrderReadModel,
  type OrderReadRepository,
} from '../domain/order-read.repository';

/** The order facts the payments module needs; amounts are the stored snapshot, never recomputed. */
export interface PayableOrder {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  currency: string;
  total: string;
  contactEmail: string;
  paymentExpiresAt: Date | null;
  description: string;
  starsAmount?: number | null;
}

const orderNotFound = () => new DomainError(ErrorCode.ORDER_NOT_FOUND, 'Pesanan tidak ditemukan.');

/**
 * Order lookup for the payments module, scoped by the same credentials as order reads (owner id
 * or guest tracking token), so payment endpoints inherit the order IDOR protections.
 */
@Injectable()
export class PayableOrderService {
  constructor(@Inject(ORDER_READ_REPOSITORY) private readonly orders: OrderReadRepository) {}

  async forCustomer(userId: string, orderId: string): Promise<PayableOrder> {
    return toPayableOrder(await this.orders.findOwnedBy(userId, orderId));
  }

  async forTelegram(telegramUserId: bigint, orderId: string): Promise<PayableOrder> {
    return toPayableOrder(await this.orders.findTelegramOwnedBy(telegramUserId, orderId));
  }

  /** Malformed and unknown tokens get the same 404. */
  async forTrackingToken(token: string): Promise<PayableOrder> {
    const order = isWellFormedGuestTrackingToken(token)
      ? await this.orders.findByTrackingTokenHash(hashGuestTrackingToken(token))
      : null;
    return toPayableOrder(order);
  }
}

function toPayableOrder(order: OrderReadModel | null): PayableOrder {
  if (!order) {
    throw orderNotFound();
  }
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    currency: order.currency,
    total: order.total,
    contactEmail: order.contactEmail,
    paymentExpiresAt: order.paymentExpiresAt,
    description: order.items.map((item) => `${item.productName} x${item.quantity}`).join(', '),
    starsAmount: order.items.every((item) => item.starsAmountSnapshot != null)
      ? order.items.reduce((sum, item) => sum + (item.starsAmountSnapshot ?? 0) * item.quantity, 0)
      : null,
  };
}
