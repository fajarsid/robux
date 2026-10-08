import { z } from 'zod';

/** Upper bound for any product quantity limit; individual products configure lower maxima. */
export const PRODUCT_QUANTITY_CEILING = 100;

export type FulfillmentMethodName = 'INSTANT' | 'GAMEPASS';

/**
 * What a product is (ADR-009). The API derives platform, fulfillment type, recipient kind and unit
 * from it; a client never chooses a fulfillment type.
 */
export const PRODUCT_LINES = [
  'ROBLOX_ROBUX',
  'TELEGRAM_PREMIUM',
  'TELEGRAM_STARS',
  'TELEGRAM_ACCOUNT',
] as const;
export type ProductLineName = (typeof PRODUCT_LINES)[number];
export type PlatformName = 'ROBLOX' | 'TELEGRAM';
export type FulfillmentTypeName = 'DIGITAL_DELIVERY' | 'RECIPIENT_FULFILLMENT' | 'BALANCE_PURCHASE';
export type RecipientTypeName = 'ROBLOX_USER' | 'TELEGRAM_USER';
/** Unit of a product's amount and of a source's balance. */
export type ProductUnitName = 'ROBUX' | 'PREMIUM_MONTH' | 'STAR' | 'ACCOUNT';

/** Server-derived description of how a product is fulfilled. */
export interface ProductFulfillmentView {
  productLine: ProductLineName;
  platform: PlatformName;
  fulfillmentType: FulfillmentTypeName;
  /** Who the customer must name at checkout; null when nothing is delivered to a recipient. */
  recipientType: RecipientTypeName | null;
  unit: ProductUnitName;
}
export type ProductAvailability = 'AVAILABLE' | 'OUT_OF_STOCK';
export type PriceVersionStatus = 'ACTIVE' | 'SCHEDULED' | 'SUPERSEDED';

/** Money travels as a decimal string ("69000" or "69000.00"), never a JSON number. */
const moneyString = z
  .string()
  .trim()
  .regex(/^\d{1,16}(\.\d{1,2})?$/);
const quantity = z.number().int().min(1).max(PRODUCT_QUANTITY_CEILING);

export const productPriceInputSchema = z.strictObject({
  sellingPrice: moneyString,
  costPrice: moneyString,
  /** Optional absolute Stars quote; it is never calculated from the IDR selling price. */
  starsAmount: z.number().int().min(1).max(1_000_000).optional(),
  /** Required to save a selling price below cost (a deliberate loss). */
  confirmBelowCost: z.boolean().optional(),
});

export const createProductRequestSchema = z.strictObject({
  slug: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  name: z.string().trim().min(2).max(80),
  robuxAmount: z.number().int().min(1).max(1_000_000),
  fulfillmentMethod: z.enum(['INSTANT', 'GAMEPASS']),
  /** Robux unless stated; fixed once the product has orders. */
  productLine: z.enum(PRODUCT_LINES).default('ROBLOX_ROBUX'),
  minQuantity: quantity.default(1),
  maxQuantity: quantity.default(10),
  displayOrder: z.number().int().min(0).max(10_000).default(0),
  initialPrice: productPriceInputSchema,
});

/** Slug is fixed after creation (stable URLs); identity fields are locked once orders exist. */
export const updateProductRequestSchema = z
  .strictObject({
    name: z.string().trim().min(2).max(80),
    robuxAmount: z.number().int().min(1).max(1_000_000),
    fulfillmentMethod: z.enum(['INSTANT', 'GAMEPASS']),
    productLine: z.enum(PRODUCT_LINES),
    minQuantity: quantity,
    maxQuantity: quantity,
    displayOrder: z.number().int().min(0).max(10_000),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'No changes');

export const createPriceVersionRequestSchema = productPriceInputSchema.extend({
  /** The version the admin was looking at; a stale value is rejected (no lost updates, no double submits). */
  basedOnVersion: z.number().int().min(1),
  /** Defaults to now. A future date schedules the price. */
  effectiveFrom: z.iso.datetime({ offset: true }).optional(),
});

export const quoteQuerySchema = z.object({
  quantity: z.coerce.number().int().min(1).max(PRODUCT_QUANTITY_CEILING),
});

export type CreateProductRequest = z.infer<typeof createProductRequestSchema>;
export type UpdateProductRequest = z.infer<typeof updateProductRequestSchema>;
export type CreatePriceVersionRequest = z.infer<typeof createPriceVersionRequestSchema>;

export interface MoneyView {
  amount: string;
  currency: string;
}

/** A price as offered: the version id lets checkout detect that the price changed meanwhile. */
export interface OfferedPriceView extends MoneyView {
  versionId: string;
  starsAmount?: number | null;
}

export interface CatalogProductView extends ProductFulfillmentView {
  id: string;
  slug: string;
  name: string;
  robuxAmount: number;
  fulfillmentMethod: FulfillmentMethodName;
  minQuantity: number;
  maxQuantity: number;
  price: OfferedPriceView;
  availability: ProductAvailability;
}

/**
 * Amounts computed by the backend, in calculation order:
 * subtotal (unit price x quantity), minus discount, plus fee, plus tax, equals total (D-06).
 */
export interface PriceBreakdownView {
  currency: string;
  unitPrice: string;
  quantity: number;
  subtotal: string;
  discount: string;
  fee: string;
  tax: string;
  total: string;
}

export interface PriceQuoteView extends PriceBreakdownView {
  productSlug: string;
  priceVersionId: string;
  totalRobux: number;
}

export interface AdminPriceVersionView {
  id: string;
  version: number;
  status: PriceVersionStatus;
  sellingPrice: string;
  starsAmount?: number | null;
  currency: string;
  effectiveFrom: string;
  createdAt: string;
  /** Present only for callers allowed to see costs (pricing.write). */
  costPrice?: string;
  margin?: string;
}

export interface AdminProductView extends ProductFulfillmentView {
  id: string;
  slug: string;
  name: string;
  robuxAmount: number;
  fulfillmentMethod: FulfillmentMethodName;
  minQuantity: number;
  maxQuantity: number;
  displayOrder: number;
  isActive: boolean;
  hasOrders: boolean;
  currentPrice: AdminPriceVersionView | null;
  latestVersion: number;
  updatedAt: string;
}

export interface AdminProductDetailView extends AdminProductView {
  prices: AdminPriceVersionView[];
}
