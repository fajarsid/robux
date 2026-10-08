import { z } from 'zod';
import { PRODUCT_LINES, type ProductLineName } from './catalog';

/** Robux balances travel as decimal strings (BIGINT in the database). */
const robux = z.string().regex(/^\d{1,15}$/);

/** Provider code as registered by the worker (`FulfillmentProviderRegistry`), e.g. `mock`. */
const providerCode = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9-]{1,39}$/);

/** Per-Robux source cost (NUMERIC(18,4)); null when the source has no cost configured. */
const costPerUnit = z
  .string()
  .regex(/^\d{1,14}(\.\d{1,4})?$/)
  .nullable();

const sourceFields = {
  name: z.string().trim().min(2).max(80),
  priority: z.number().int().min(0).max(10_000),
  lowBalanceThreshold: robux,
  costPerUnit,
};

/**
 * A new source starts DISABLED (kill switch on) and with health UNKNOWN; it enters routing once
 * it is activated and its provider answers the health check. Credentials are never set here.
 */
export const createSourceRequestSchema = z.strictObject({
  ...sourceFields,
  provider: providerCode,
  /** Which product line's units the balance counts; fixed after creation, like the provider. */
  productLine: z.enum(PRODUCT_LINES).default('ROBLOX_ROBUX'),
  openingBalance: robux.default('0'),
});

/** The provider of a source is fixed: its allocations and attempts refer to it. */
export const updateSourceRequestSchema = z.strictObject(sourceFields);

/** Manual stock correction (top-up or write-off), always with a reason for the ledger and audit. */
export const adjustSourceBalanceRequestSchema = z.strictObject({
  delta: z
    .string()
    .regex(/^-?\d{1,15}$/)
    .refine((value) => BigInt(value) !== 0n, 'delta must not be zero'),
  reason: z.string().trim().min(3).max(200),
});

export type CreateSourceRequest = z.infer<typeof createSourceRequestSchema>;
export type UpdateSourceRequest = z.infer<typeof updateSourceRequestSchema>;
export type AdjustSourceBalanceRequest = z.infer<typeof adjustSourceBalanceRequestSchema>;

export type SourceStatusName = 'ACTIVE' | 'DISABLED';
export type SourceHealthName = 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE' | 'UNKNOWN';

/** Staff view of a fulfillment source. Never contains credentials or their reference. */
export interface AdminSourceView {
  id: string;
  name: string;
  provider: string;
  productLine: ProductLineName;
  status: SourceStatusName;
  health: SourceHealthName;
  availableBalance: string;
  reservedBalance: string;
  lowBalanceThreshold: string;
  /** Available balance is below the threshold (since `lowBalanceSince`). */
  lowBalance: boolean;
  lowBalanceSince: string | null;
  priority: number;
  /** Only for staff who manage inventory; absent otherwise. */
  costPerUnit?: string | null;
  consecutiveFailures: number;
  lastHealthCheckAt: string | null;
  updatedAt: string;
}
export const createDigitalAccountInventoryRequestSchema = z.strictObject({
  productId: z.string().uuid(),
  sourceId: z.string().uuid(),
  username: z.string().trim().min(1).max(128),
  password: z.string().min(1).max(512),
  recoveryInfo: z.string().max(2048).optional(),
});
export type CreateDigitalAccountInventoryRequest = z.infer<
  typeof createDigitalAccountInventoryRequestSchema
>;

export interface DigitalAccountInventoryView {
  id: string;
  productId: string;
  productName: string;
  sourceId: string;
  sourceName: string;
  status: 'AVAILABLE' | 'RESERVED' | 'SOLD' | 'DELIVERED' | 'BLOCKED';
  createdAt: string;
  updatedAt: string;
}
