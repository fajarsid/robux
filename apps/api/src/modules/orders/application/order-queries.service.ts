import { Inject, Injectable } from '@nestjs/common';
import {
  type AdminOrderView,
  type CustomerOrderDetailView,
  type CustomerOrderSummaryView,
  ErrorCode,
  type GuestOrderTrackingView,
} from '@robux/shared';
import { DomainError } from '../../../common/errors/domain-error';
import {
  hashGuestTrackingToken,
  isWellFormedGuestTrackingToken,
} from '../domain/guest-tracking-token';
import { ORDER_READ_REPOSITORY, type OrderReadRepository } from '../domain/order-read.repository';
import { toPublicOrderStage } from '../domain/public-order-stage';
import { toAdminOrderView, toTrackingView } from './order-views';

const ORDER_HISTORY_PAGE_SIZE = 50;

const orderNotFound = () => new DomainError(ErrorCode.ORDER_NOT_FOUND, 'Pesanan tidak ditemukan.');

/** Read-only order access for guests (by tracking token), customers (by ownership) and staff. */
@Injectable()
export class OrderQueriesService {
  constructor(@Inject(ORDER_READ_REPOSITORY) private readonly orders: OrderReadRepository) {}

  /** Malformed and unknown tokens get the same 404, so responses reveal nothing about other orders. */
  async trackAsGuest(token: string): Promise<GuestOrderTrackingView> {
    const order = isWellFormedGuestTrackingToken(token)
      ? await this.orders.findByTrackingTokenHash(hashGuestTrackingToken(token))
      : null;
    if (!order) {
      throw orderNotFound();
    }
    return toTrackingView(order);
  }

  async listForCustomer(userId: string): Promise<CustomerOrderSummaryView[]> {
    const orders = await this.orders.listOwnedBy(userId, ORDER_HISTORY_PAGE_SIZE);
    return orders.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      stage: toPublicOrderStage(order.status),
      currency: order.currency,
      total: order.total,
      totalRobux: order.items.reduce((sum, item) => sum + item.robuxAmount * item.quantity, 0),
      createdAt: order.createdAt.toISOString(),
    }));
  }

  /** Someone else's order and a non-existent order are indistinguishable (404). */
  async getForCustomer(userId: string, orderId: string): Promise<CustomerOrderDetailView> {
    const order = await this.orders.findOwnedBy(userId, orderId);
    if (!order) {
      throw orderNotFound();
    }
    return { id: order.id, ...toTrackingView(order) };
  }

  async getForStaff(orderId: string): Promise<AdminOrderView> {
    const order = await this.orders.findById(orderId);
    if (!order) {
      throw orderNotFound();
    }
    return toAdminOrderView(order);
  }
}
