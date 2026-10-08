import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  type CreateDigitalAccountInventoryRequest,
  type DigitalAccountInventoryView,
} from '@robux/shared';
import { AesGcmSecretCipher } from '../../../common/security/aes-gcm-secret.cipher';
import { APP_CONFIG } from '../../../config/app-config.module';
import type { AppConfig } from '../../../config/app-config';
import { PrismaService } from '../../../common/database/prisma.service';
import { DomainError } from '../../../common/errors/domain-error';
import type { RequestContext } from '../../../common/http/request-context';
import type { AuthenticatedPrincipal } from '../../auth/domain/authenticated-principal';
import { RecordAuditEventService } from '../../audit/application/record-audit-event.service';
import {
  clearLowBalanceIfRecovered,
  markLowBalanceIfCrossed,
} from '../infrastructure/inventory-ledger.writer';

@Injectable()
export class DigitalAccountInventoryService {
  private readonly cipher: AesGcmSecretCipher;
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: RecordAuditEventService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    if (!config.accountInventory) throw new Error('Account inventory encryption is required');
    this.cipher = new AesGcmSecretCipher(
      config.accountInventory.encryptionKey,
      config.accountInventory.keyVersion,
    );
  }

  async list(): Promise<DigitalAccountInventoryView[]> {
    const items = await this.prisma.digitalInventoryItem.findMany({
      select: {
        id: true,
        productId: true,
        sourceId: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        product: { select: { name: true } },
        source: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return items.map((item) => ({
      id: item.id,
      productId: item.productId,
      productName: item.product.name,
      sourceId: item.sourceId,
      sourceName: item.source.name,
      status: item.status,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    }));
  }

  async create(
    actor: AuthenticatedPrincipal,
    input: CreateDigitalAccountInventoryRequest,
    context: RequestContext,
  ) {
    const [product, source] = await Promise.all([
      this.prisma.product.findUnique({
        where: { id: input.productId },
        select: { id: true, productLine: true },
      }),
      this.prisma.fulfillmentSource.findUnique({
        where: { id: input.sourceId },
        select: { id: true, productLine: true },
      }),
    ]);
    if (product?.productLine !== 'TELEGRAM_ACCOUNT' || source?.productLine !== 'TELEGRAM_ACCOUNT') {
      throw new DomainError(
        ErrorCode.INVALID_SOURCE_STATE,
        'Product and source must be Telegram Account inventory.',
      );
    }
    const ciphertext = this.cipher.encrypt(
      Buffer.from(
        JSON.stringify({
          username: input.username,
          password: input.password,
          ...(input.recoveryInfo ? { recoveryInfo: input.recoveryInfo } : {}),
        }),
        'utf8',
      ),
    );
    const item = await this.prisma.$transaction(async (tx) => {
      const [balance] = await tx.$queryRaw<
        { available_balance: bigint; reserved_balance: bigint }[]
      >`
        UPDATE fulfillment_sources SET available_balance = available_balance + 1, updated_at = now()
        WHERE id = ${input.sourceId}::uuid AND product_line = 'TELEGRAM_ACCOUNT'
        RETURNING available_balance, reserved_balance`;
      if (!balance)
        throw new DomainError(ErrorCode.INVALID_SOURCE_STATE, 'Inventory source is unavailable.');
      await clearLowBalanceIfRecovered(tx, input.sourceId);
      await markLowBalanceIfCrossed(tx, input.sourceId, context.requestId ?? null);
      const created = await tx.digitalInventoryItem.create({
        data: {
          productId: input.productId,
          sourceId: input.sourceId,
          encryptedPayload: Uint8Array.from(ciphertext),
          keyVersion: this.cipher.keyVersion,
        },
        select: { id: true, status: true },
      });
      await tx.sourceBalanceLog.create({
        data: {
          sourceId: input.sourceId,
          reason: 'ADJUSTMENT',
          deltaAvailable: 1n,
          deltaReserved: 0n,
          availableAfter: balance.available_balance,
          reservedAfter: balance.reserved_balance,
          note: 'Telegram account inventory added',
          requestId: context.requestId ?? null,
        },
      });
      return created;
    });
    await this.audit.record({
      action: 'INVENTORY_ITEM_CREATED',
      result: 'SUCCESS',
      actorType: 'STAFF',
      actorUserId: actor.userId,
      actorRole: actor.role,
      resourceType: 'digital_inventory_item',
      resourceId: item.id,
      after: { productId: input.productId, sourceId: input.sourceId, status: item.status },
      ipAddress: context.ipAddress,
      requestId: context.requestId,
    });
    return { id: item.id, status: item.status };
  }

  async block(actor: AuthenticatedPrincipal, id: string, context: RequestContext): Promise<void> {
    const blocked = await this.prisma.$transaction(async (tx) => {
      const [item] = await tx.$queryRaw<{ id: string; source_id: string }[]>`
        UPDATE digital_inventory_items SET status = 'BLOCKED', updated_at = now()
        WHERE id = ${id}::uuid AND status = 'AVAILABLE' RETURNING id::text AS id, source_id::text AS source_id`;
      if (!item) return null;
      const [balance] = await tx.$queryRaw<
        { available_balance: bigint; reserved_balance: bigint }[]
      >`
        UPDATE fulfillment_sources SET available_balance = available_balance - 1, updated_at = now()
        WHERE id = ${item.source_id}::uuid AND available_balance > 0 RETURNING available_balance, reserved_balance`;
      if (!balance)
        throw new DomainError(
          ErrorCode.INVALID_SOURCE_STATE,
          'Inventory source balance is inconsistent.',
        );
      await markLowBalanceIfCrossed(tx, item.source_id, context.requestId ?? null);
      await tx.sourceBalanceLog.create({
        data: {
          sourceId: item.source_id,
          reason: 'ADJUSTMENT',
          deltaAvailable: -1n,
          deltaReserved: 0n,
          availableAfter: balance.available_balance,
          reservedAfter: balance.reserved_balance,
          note: 'Telegram account inventory blocked',
          requestId: context.requestId ?? null,
        },
      });
      return item;
    });
    if (!blocked)
      throw new DomainError(ErrorCode.NOT_FOUND, 'Inventory item not found or not available.');
    await this.audit.record({
      action: 'INVENTORY_ITEM_BLOCKED',
      result: 'SUCCESS',
      actorType: 'STAFF',
      actorUserId: actor.userId,
      actorRole: actor.role,
      resourceType: 'digital_inventory_item',
      resourceId: id,
      after: { status: 'BLOCKED' },
      ipAddress: context.ipAddress,
      requestId: context.requestId,
    });
  }
}
