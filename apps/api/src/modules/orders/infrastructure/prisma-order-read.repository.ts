import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import type { Prisma } from '../../../generated/prisma/client';
import type { OrderReadModel, OrderReadRepository } from '../domain/order-read.repository';

const ORDER_READ_SELECT = {
  id: true,
  orderNumber: true,
  status: true,
  userId: true,
  contactEmail: true,
  currency: true,
  subtotal: true,
  discount: true,
  fee: true,
  tax: true,
  total: true,
  productLine: true,
  platform: true,
  fulfillmentType: true,
  recipientType: true,
  recipientUsername: true,
  recipientRobloxUserId: true,
  cancelReason: true,
  paymentExpiresAt: true,
  createdAt: true,
  items: {
    select: {
      productNameSnapshot: true,
      robuxAmount: true,
      quantity: true,
      unitPriceSnapshot: true,
      lineSubtotal: true,
      starsAmountSnapshot: true,
    },
    orderBy: { id: 'asc' },
  },
  statusHistory: {
    select: { fromStatus: true, toStatus: true, actorType: true, reason: true, createdAt: true },
    orderBy: { id: 'asc' },
  },
} as const satisfies Prisma.OrderSelect;

type OrderReadRow = Prisma.OrderGetPayload<{ select: typeof ORDER_READ_SELECT }>;

function toReadModel(row: OrderReadRow): OrderReadModel {
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    status: row.status,
    userId: row.userId,
    contactEmail: row.contactEmail,
    currency: row.currency,
    subtotal: row.subtotal.toFixed(2),
    discount: row.discount.toFixed(2),
    fee: row.fee.toFixed(2),
    tax: row.tax.toFixed(2),
    total: row.total.toFixed(2),
    productLine: row.productLine,
    platform: row.platform,
    fulfillmentType: row.fulfillmentType,
    recipientType: row.recipientType,
    recipientUsername: row.recipientUsername,
    recipientRobloxUserId: row.recipientRobloxUserId?.toString() ?? null,
    cancelReason: row.cancelReason,
    paymentExpiresAt: row.paymentExpiresAt,
    createdAt: row.createdAt,
    items: row.items.map((item) => ({
      productName: item.productNameSnapshot,
      robuxAmount: item.robuxAmount,
      quantity: item.quantity,
      unitPrice: item.unitPriceSnapshot.toFixed(2),
      lineSubtotal: item.lineSubtotal.toFixed(2),
      starsAmountSnapshot: item.starsAmountSnapshot,
    })),
    history: row.statusHistory,
  };
}

@Injectable()
export class PrismaOrderReadRepository implements OrderReadRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByTrackingTokenHash(tokenHash: string): Promise<OrderReadModel | null> {
    const row = await this.prisma.order.findUnique({
      where: { trackingTokenHash: tokenHash },
      select: ORDER_READ_SELECT,
    });
    return row ? toReadModel(row) : null;
  }

  async findOwnedBy(userId: string, orderId: string): Promise<OrderReadModel | null> {
    const row = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      select: ORDER_READ_SELECT,
    });
    return row ? toReadModel(row) : null;
  }

  async findTelegramOwnedBy(telegramUserId: bigint, orderId: string): Promise<OrderReadModel | null> {
    const row = await this.prisma.order.findFirst({
      where: { id: orderId, telegramOrder: { is: { telegramUserId } } },
      select: ORDER_READ_SELECT,
    });
    return row ? toReadModel(row) : null;
  }

  async listTelegramOwnedBy(telegramUserId: bigint, limit: number): Promise<OrderReadModel[]> {
    const rows = await this.prisma.order.findMany({
      where: { telegramOrder: { is: { telegramUserId } } },
      select: ORDER_READ_SELECT,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map(toReadModel);
  }

  async listOwnedBy(userId: string, limit: number): Promise<OrderReadModel[]> {
    const rows = await this.prisma.order.findMany({
      where: { userId },
      select: ORDER_READ_SELECT,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map(toReadModel);
  }

  async findById(orderId: string): Promise<OrderReadModel | null> {
    const row = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: ORDER_READ_SELECT,
    });
    return row ? toReadModel(row) : null;
  }
}
