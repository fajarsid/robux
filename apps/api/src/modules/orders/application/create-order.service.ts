import { Inject, Injectable } from '@nestjs/common';
import {
  type CreateOrderRequest,
  ErrorCode,
  IDEMPOTENCY_KEY_PATTERN,
  type OrderCreatedView,
} from '@robux/shared';
import { productLineProfile } from '../../products/domain/product-line';
import { DomainError } from '../../../common/errors/domain-error';
import type { RequestContext } from '../../../common/http/request-context';
import type { AuthenticatedPrincipal } from '../../auth/domain/authenticated-principal';
import { isStaffRole } from '../../auth/domain/permissions';
import { toPriceBreakdownView } from '../../pricing/application/price-breakdown.view';
import { quotePrice } from '../../pricing/domain/price-quote';
import { CatalogService } from '../../products/application/catalog.service';
import { SystemSettingsService } from '../../settings/application/system-settings.service';
import { resolveOrderRecipient } from '../domain/order-recipient';
import { generateGuestTrackingToken } from '../domain/guest-tracking-token';
import {
  IdempotencyKeyTaken,
  ORDER_CREATION_REPOSITORY,
  type OrderCreationRepository,
} from '../domain/order-creation.repository';
import {
  idempotencyScope,
  ORDER_IDEMPOTENCY_WINDOW_MS,
  requestFingerprint,
} from '../domain/order-idempotency';
import {
  ORDER_NUMBER_ALLOCATOR,
  type OrderNumberAllocator,
} from '../domain/order-number-allocator';
import { ReplayableResponseCodec } from './replayable-response.codec';

/** Provisional payment window until the payment phase confirms it (see IMPLEMENTATION_PLAN §15). */
const DEFAULT_PAYMENT_EXPIRY_MINUTES = 60;

/**
 * Creates an order in PAYMENT_PENDING from a product, a quantity and the price version the
 * customer saw. The backend decides price, totals and eligibility; the same Idempotency-Key
 * always yields the same order.
 */
@Injectable()
export class CreateOrderService {
  constructor(
    private readonly catalog: CatalogService,
    private readonly settings: SystemSettingsService,
    private readonly responses: ReplayableResponseCodec,
    @Inject(ORDER_NUMBER_ALLOCATOR) private readonly orderNumbers: OrderNumberAllocator,
    @Inject(ORDER_CREATION_REPOSITORY) private readonly orders: OrderCreationRepository,
  ) {}

  async create(
    request: CreateOrderRequest,
    idempotencyKey: string | undefined,
    principal: AuthenticatedPrincipal | undefined,
    context: RequestContext,
    now = new Date(),
  ): Promise<{ order: OrderCreatedView; replayed: boolean }> {
    if (!idempotencyKey || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      throw new DomainError(
        ErrorCode.IDEMPOTENCY_KEY_REQUIRED,
        'Header Idempotency-Key wajib diisi (16–128 karakter acak).',
      );
    }
    if (principal && isStaffRole(principal.role)) {
      throw new DomainError(
        ErrorCode.STAFF_CANNOT_ORDER,
        'Akun staf tidak dapat membuat pesanan. Gunakan akun pelanggan.',
      );
    }
    const contactEmail = principal?.email ?? request.contactEmail;
    if (!contactEmail) {
      throw new DomainError(
        ErrorCode.VALIDATION_FAILED,
        'Email kontak wajib diisi untuk pesanan tamu.',
      );
    }

    const scope = idempotencyScope(principal?.userId);
    const requestHash = requestFingerprint({ ...request, contactEmail });
    const replay = await this.replayIfKnown(scope, idempotencyKey, requestHash, principal);
    if (replay) {
      return { order: replay, replayed: true };
    }

    const offer = await this.catalog.offerForPurchase(request.productId, now);
    if (offer.price.id !== request.priceVersionId) {
      throw new DomainError(
        ErrorCode.PRICE_CHANGED,
        'Harga produk telah berubah. Periksa harga terbaru sebelum melanjutkan.',
      );
    }
    if (offer.availability !== 'AVAILABLE') {
      throw new DomainError(ErrorCode.PRODUCT_UNAVAILABLE, 'Stok produk sedang habis.');
    }
    const line = productLineProfile(offer.product.productLine);
    const recipient = resolveOrderRecipient(line.recipientType, request.recipient);
    const quote = quotePrice({
      unitPrice: offer.price.sellingPrice,
      currency: offer.price.currency,
      quantity: request.quantity,
      minQuantity: offer.product.minQuantity,
      maxQuantity: offer.product.maxQuantity,
      robuxAmount: offer.product.robuxAmount,
    });

    const expiryMinutes = await this.settings.positiveInteger(
      'PAYMENT_EXPIRY_MINUTES',
      DEFAULT_PAYMENT_EXPIRY_MINUTES,
    );
    const paymentExpiresAt = new Date(now.getTime() + expiryMinutes * 60_000);
    const orderNumber = await this.orderNumbers.allocate(now);
    const tracking = generateGuestTrackingToken();
    const view: Omit<OrderCreatedView, 'orderId'> = {
      orderNumber,
      trackingToken: tracking.token,
      stage: 'AWAITING_PAYMENT',
      pricing: toPriceBreakdownView(quote),
      recipientUsername: recipient?.identifier ?? null,
      paymentExpiresAt: paymentExpiresAt.toISOString(),
    };

    try {
      const { orderId } = await this.orders.create({
        orderNumber,
        trackingTokenHash: tracking.hash,
        userId: principal?.userId ?? null,
        contactEmail,
        recipient,
        currency: quote.currency,
        fulfillmentMethod: offer.product.fulfillmentMethod,
        // Derived on the server from the product; the request has no say in it.
        productLine: offer.product.productLine,
        platform: line.platform,
        fulfillmentType: line.fulfillmentType,
        subtotal: quote.subtotal,
        discount: quote.discount,
        fee: quote.fee,
        tax: quote.tax,
        total: quote.total,
        paymentExpiresAt,
        item: {
          productId: offer.product.id,
          productPriceId: offer.price.id,
          productName: offer.product.name,
          robuxAmount: offer.product.robuxAmount,
          quantity: quote.quantity,
          unitPrice: quote.unitPrice,
          unitCost: offer.price.costPrice,
          lineSubtotal: quote.subtotal,
          starsAmountSnapshot: offer.price.starsAmount ?? null,
        },
        idempotency: {
          scope,
          key: idempotencyKey,
          requestHash,
          expiresAt: new Date(now.getTime() + ORDER_IDEMPOTENCY_WINDOW_MS),
          response: this.responses.seal(view),
        },
        actorType: 'CUSTOMER',
        actorUserId: principal?.userId,
        requestId: context.requestId,
      });
      return { order: principal ? { ...view, orderId } : view, replayed: false };
    } catch (error) {
      if (error instanceof IdempotencyKeyTaken) {
        const concurrent = await this.replayIfKnown(scope, idempotencyKey, requestHash, principal);
        if (concurrent) {
          return { order: concurrent, replayed: true };
        }
      }
      throw error;
    }
  }

  private async replayIfKnown(
    scope: string,
    key: string,
    requestHash: string,
    principal: AuthenticatedPrincipal | undefined,
  ): Promise<OrderCreatedView | null> {
    const stored = await this.orders.findIdempotentResponse(scope, key);
    if (!stored) {
      return null;
    }
    if (stored.requestHash !== requestHash) {
      throw new DomainError(
        ErrorCode.DUPLICATE_IDEMPOTENCY_KEY,
        'Idempotency-Key ini sudah dipakai untuk pesanan yang berbeda.',
      );
    }
    const view = this.responses.open(stored.response);
    return principal && stored.orderId ? { ...view, orderId: stored.orderId } : view;
  }
}
