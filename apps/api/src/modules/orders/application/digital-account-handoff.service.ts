import { Inject, Injectable } from '@nestjs/common';
import { ErrorCode } from '@robux/shared';
import { AesGcmSecretCipher } from '../../../common/security/aes-gcm-secret.cipher';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../common/database/prisma.service';
import type { AppConfig } from '../../../config/app-config';
import { APP_CONFIG } from '../../../config/app-config.module';
import {
  hashGuestTrackingToken,
  isWellFormedGuestTrackingToken,
} from '../domain/guest-tracking-token';

export interface DigitalAccountHandoff {
  username: string;
  password: string;
  recoveryInfo?: string;
}

@Injectable()
export class DigitalAccountHandoffService {
  private readonly cipher: AesGcmSecretCipher;
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    if (!config.accountInventory) throw new Error('Account inventory encryption is required');
    this.cipher = new AesGcmSecretCipher(
      config.accountInventory.encryptionKey,
      config.accountInventory.keyVersion,
    );
  }

  async forCustomer(userId: string, orderId: string): Promise<DigitalAccountHandoff[]> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      select: { id: true, status: true, productLine: true },
    });
    if (!order) throw new DomainError(ErrorCode.ORDER_NOT_FOUND, 'Pesanan tidak ditemukan.');
    return this.reveal(order.id, order.status, order.productLine, 'CUSTOMER', userId);
  }

  async forGuest(token: string): Promise<DigitalAccountHandoff[]> {
    if (!isWellFormedGuestTrackingToken(token))
      throw new DomainError(ErrorCode.ORDER_NOT_FOUND, 'Pesanan tidak ditemukan.');
    const order = await this.prisma.order.findUnique({
      where: { trackingTokenHash: hashGuestTrackingToken(token) },
      select: { id: true, status: true, productLine: true },
    });
    if (!order) throw new DomainError(ErrorCode.ORDER_NOT_FOUND, 'Pesanan tidak ditemukan.');
    return this.reveal(order.id, order.status, order.productLine, 'SYSTEM', null);
  }

  async forTelegram(telegramUserId: bigint, orderId: string): Promise<DigitalAccountHandoff[]> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, telegramOrder: { is: { telegramUserId } } },
      select: { id: true, status: true, productLine: true },
    });
    if (!order) throw new DomainError(ErrorCode.ORDER_NOT_FOUND, 'Pesanan tidak ditemukan.');
    return this.reveal(order.id, order.status, order.productLine, 'SYSTEM', null);
  }

  private async reveal(
    orderId: string,
    status: string,
    line: string,
    actorType: 'CUSTOMER' | 'SYSTEM',
    actorUserId: string | null,
  ) {
    if (status !== 'FULFILLED' || line !== 'TELEGRAM_ACCOUNT')
      throw new DomainError(ErrorCode.ORDER_NOT_FOUND, 'Informasi pengiriman tidak tersedia.');
    const items = await this.prisma.digitalInventoryItem.findMany({
      where: { orderId, status: { in: ['SOLD', 'DELIVERED'] } },
      select: { id: true, encryptedPayload: true, keyVersion: true, status: true },
    });
    if (!items.length)
      throw new DomainError(ErrorCode.ORDER_NOT_FOUND, 'Informasi pengiriman tidak tersedia.');
    await this.prisma.$transaction(async (tx) => {
      const ids = items.filter((item) => item.status === 'SOLD').map((item) => item.id);
      if (ids.length) {
        await tx.digitalInventoryItem.updateMany({
          where: { id: { in: ids }, status: 'SOLD' },
          data: { status: 'DELIVERED', deliveredAt: new Date() },
        });
        for (const id of ids)
          await tx.auditLog.create({
            data: {
              action: 'INVENTORY_ITEM_DELIVERED',
              result: 'SUCCESS',
              actorType,
              actorUserId,
              resourceType: 'digital_inventory_item',
              resourceId: id,
              after: { orderId, status: 'DELIVERED' },
            },
          });
      }
    });
    try {
      return items.map(
        (item) =>
          JSON.parse(
            this.cipher
              .decrypt(Buffer.from(item.encryptedPayload), item.keyVersion)
              .toString('utf8'),
          ) as DigitalAccountHandoff,
      );
    } catch {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 'Informasi pengiriman tidak dapat dibuka.');
    }
  }
}
