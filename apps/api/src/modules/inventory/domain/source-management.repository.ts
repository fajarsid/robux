import type { ProductLineName } from '@robux/shared';
import type { SourceHealth, SourceStatus } from '../../../generated/prisma/enums';

export interface SourceRecord {
  id: string;
  name: string;
  provider: string;
  productLine: ProductLineName;
  status: SourceStatus;
  health: SourceHealth;
  availableBalance: bigint;
  reservedBalance: bigint;
  lowBalanceThreshold: bigint;
  lowBalanceSince: Date | null;
  priority: number;
  costPerUnit: string | null;
  consecutiveFailures: number;
  lastHealthCheckAt: Date | null;
  updatedAt: Date;
}

export interface SourceFields {
  name: string;
  priority: number;
  lowBalanceThreshold: bigint;
  costPerUnit: string | null;
}

/**
 * Staff-side source management. Balance changes go through the same conditional, ledgered and
 * low-balance-aware writes as fulfillment, so the CHECKs and the ledger hold for manual changes too.
 */
export interface SourceManagementRepository {
  list(): Promise<SourceRecord[]>;
  find(id: string): Promise<SourceRecord | null>;
  /** Null when the name is taken. */
  create(
    fields: SourceFields & {
      provider: string;
      productLine: ProductLineName;
      openingBalance: bigint;
    },
    requestId: string | null,
  ): Promise<SourceRecord | null>;
  /** Null when the name is taken. */
  update(id: string, fields: SourceFields, requestId: string | null): Promise<SourceRecord | null>;
  /** The kill switch. Existing allocations keep their reservation and finish their lifecycle. */
  setStatus(id: string, status: SourceStatus): Promise<SourceRecord>;
  /** Null when the change would make the available balance negative. */
  adjust(
    id: string,
    delta: bigint,
    note: string,
    requestId: string | null,
  ): Promise<SourceRecord | null>;
}

export const SOURCE_MANAGEMENT_REPOSITORY = Symbol('SOURCE_MANAGEMENT_REPOSITORY');
