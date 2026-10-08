import type {
  FulfillmentTypeName,
  PlatformName,
  ProductLineName,
  RecipientTypeName,
} from '@robux/shared';
import type { OrderCancelReason, OrderStatus } from '../../../generated/prisma/enums';

export interface OrderReadModel {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  userId: string | null;
  contactEmail: string;
  currency: string;
  subtotal: string;
  discount: string;
  fee: string;
  tax: string;
  total: string;
  productLine: ProductLineName;
  platform: PlatformName;
  fulfillmentType: FulfillmentTypeName;
  recipientType: RecipientTypeName | null;
  recipientUsername: string | null;
  recipientRobloxUserId: string | null;
  cancelReason: OrderCancelReason | null;
  paymentExpiresAt: Date | null;
  createdAt: Date;
  items: {
    productName: string;
    robuxAmount: number;
    quantity: number;
    unitPrice: string;
    lineSubtotal: string;
    starsAmountSnapshot?: number | null;
  }[];
  history: {
    fromStatus: OrderStatus | null;
    toStatus: OrderStatus;
    actorType: string;
    reason: string | null;
    createdAt: Date;
  }[];
}

/**
 * Every customer lookup is scoped by the credential that grants access (owner id or tracking
 * token hash), so an id alone can never return someone else's order. `findById` is for staff
 * endpoints guarded by orders.read.any.
 */
export interface OrderReadRepository {
  findByTrackingTokenHash(tokenHash: string): Promise<OrderReadModel | null>;
  findOwnedBy(userId: string, orderId: string): Promise<OrderReadModel | null>;
  findTelegramOwnedBy(telegramUserId: bigint, orderId: string): Promise<OrderReadModel | null>;
  listTelegramOwnedBy(telegramUserId: bigint, limit: number): Promise<OrderReadModel[]>;
  listOwnedBy(userId: string, limit: number): Promise<OrderReadModel[]>;
  findById(orderId: string): Promise<OrderReadModel | null>;
}

export const ORDER_READ_REPOSITORY = Symbol('ORDER_READ_REPOSITORY');
