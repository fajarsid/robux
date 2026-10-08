import { Inject, Injectable } from '@nestjs/common';
import {
  type CreatePriceVersionRequest,
  type CreateProductRequest,
  ErrorCode,
  type UpdateProductRequest,
} from '@robux/shared';
import { DomainError } from '../../../common/errors/domain-error';
import type { RequestContext } from '../../../common/http/request-context';
import type { AuditAction } from '../../../generated/prisma/enums';
import { RecordAuditEventService } from '../../audit/application/record-audit-event.service';
import type { AuthenticatedPrincipal } from '../../auth/domain/authenticated-principal';
import {
  DEFAULT_CURRENCY,
  PriceVersionService,
} from '../../pricing/application/price-version.service';
import { formatMoneyAmount, parseMoney } from '../../pricing/domain/money';
import { assertValidNewPrice } from '../../pricing/domain/price-version';
import {
  assertCanActivate,
  assertChangesAllowed,
  assertMethodFitsLine,
  assertValidQuantityLimits,
  type Product,
} from '../domain/product';
import { PRODUCT_REPOSITORY, type ProductRepository } from '../domain/product.repository';

const notFound = () => new DomainError(ErrorCode.NOT_FOUND, 'Produk tidak ditemukan.');

/** Admin commands on products and their prices. Every successful change is audited. */
@Injectable()
export class ProductManagementService {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
    private readonly prices: PriceVersionService,
    private readonly audit: RecordAuditEventService,
  ) {}

  async create(
    actor: AuthenticatedPrincipal,
    request: CreateProductRequest,
    context: RequestContext,
  ): Promise<Product> {
    assertValidQuantityLimits(request.minQuantity, request.maxQuantity);
    assertMethodFitsLine(request.fulfillmentMethod, request.productLine);
    const sellingPrice = parseMoney(request.initialPrice.sellingPrice);
    const costPrice = parseMoney(request.initialPrice.costPrice);
    assertValidNewPrice({
      sellingPrice,
      costPrice,
      currency: DEFAULT_CURRENCY,
      starsAmount: request.initialPrice.starsAmount,
      confirmBelowCost: request.initialPrice.confirmBelowCost,
    });
    const productFields = {
      slug: request.slug,
      name: request.name,
      robuxAmount: request.robuxAmount,
      fulfillmentMethod: request.fulfillmentMethod,
      productLine: request.productLine,
      minQuantity: request.minQuantity,
      maxQuantity: request.maxQuantity,
      displayOrder: request.displayOrder,
    };
    const product = await this.products.createWithInitialPrice(productFields, {
      sellingPrice,
      costPrice,
      currency: DEFAULT_CURRENCY,
      starsAmount: request.initialPrice.starsAmount,
      effectiveFrom: new Date(),
      createdById: actor.userId,
    });
    if (!product) {
      throw new DomainError(ErrorCode.INVALID_PRODUCT_STATE, 'Slug produk sudah digunakan.');
    }
    await this.record(actor, context, 'PRODUCT_CREATED', product.id, undefined, {
      ...productFields,
      sellingPrice: formatMoneyAmount(sellingPrice),
      costPrice: formatMoneyAmount(costPrice),
      starsAmount: request.initialPrice.starsAmount ?? null,
    });
    return product;
  }

  async update(
    actor: AuthenticatedPrincipal,
    productId: string,
    changes: UpdateProductRequest,
    context: RequestContext,
  ): Promise<Product> {
    const product = await this.products.findById(productId);
    if (!product) {
      throw notFound();
    }
    const hasOrders = (await this.products.productIdsWithOrders([productId])).has(productId);
    assertChangesAllowed(product, changes, hasOrders);
    const updated = await this.products.update(productId, changes);
    const changedFields = Object.keys(changes) as (keyof UpdateProductRequest)[];
    await this.record(
      actor,
      context,
      'PRODUCT_CHANGED',
      productId,
      Object.fromEntries(changedFields.map((field) => [field, product[field]])),
      Object.fromEntries(changedFields.map((field) => [field, updated[field]])),
    );
    return updated;
  }

  async setActive(
    actor: AuthenticatedPrincipal,
    productId: string,
    active: boolean,
    context: RequestContext,
  ): Promise<Product> {
    const product = await this.products.findById(productId);
    if (!product) {
      throw notFound();
    }
    if (active) {
      assertCanActivate(
        product,
        this.prices.activeFor(await this.prices.history(productId)) !== null,
      );
    }
    if (await this.products.setActive(productId, active)) {
      await this.record(
        actor,
        context,
        active ? 'PRODUCT_ACTIVATED' : 'PRODUCT_DEACTIVATED',
        productId,
        { isActive: !active },
        { isActive: active },
      );
    }
    return (await this.products.findById(productId)) ?? product;
  }

  async changePrice(
    actor: AuthenticatedPrincipal,
    productId: string,
    request: CreatePriceVersionRequest,
    context: RequestContext,
  ): Promise<void> {
    const product = await this.products.findById(productId);
    if (!product || product.archivedAt) {
      throw notFound();
    }
    const previous = this.prices.activeFor(await this.prices.history(productId));
    const created = await this.prices.appendVersion({
      productId,
      basedOnVersion: request.basedOnVersion,
      sellingPrice: request.sellingPrice,
      costPrice: request.costPrice,
      effectiveFrom: request.effectiveFrom ? new Date(request.effectiveFrom) : undefined,
      confirmBelowCost: request.confirmBelowCost,
      starsAmount: request.starsAmount,
      createdById: actor.userId,
    });
    await this.record(
      actor,
      context,
      'PRICE_CHANGED',
      productId,
      previous
        ? {
            version: previous.version,
            sellingPrice: formatMoneyAmount(previous.sellingPrice),
            costPrice: formatMoneyAmount(previous.costPrice),
          }
        : undefined,
      {
        version: created.version,
        sellingPrice: formatMoneyAmount(created.sellingPrice),
        costPrice: formatMoneyAmount(created.costPrice),
        starsAmount: created.starsAmount,
        effectiveFrom: created.effectiveFrom.toISOString(),
      },
    );
  }

  private record(
    actor: AuthenticatedPrincipal,
    context: RequestContext,
    action: AuditAction,
    productId: string,
    before: Record<string, unknown> | undefined,
    after: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.record({
      action,
      result: 'SUCCESS',
      actorType: 'STAFF',
      actorUserId: actor.userId,
      actorRole: actor.role,
      resourceType: 'product',
      resourceId: productId,
      before,
      after,
      ipAddress: context.ipAddress,
      requestId: context.requestId,
    });
  }
}
