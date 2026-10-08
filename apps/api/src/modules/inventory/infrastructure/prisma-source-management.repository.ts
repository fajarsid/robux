import { Injectable } from '@nestjs/common';
import type { ProductLineName } from '@robux/shared';
import { PrismaService } from '../../../common/database/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import type { SourceStatus } from '../../../generated/prisma/enums';
import type {
  SourceFields,
  SourceManagementRepository,
  SourceRecord,
} from '../domain/source-management.repository';
import { clearLowBalanceIfRecovered, markLowBalanceIfCrossed } from './inventory-ledger.writer';

type Tx = Prisma.TransactionClient;

const SOURCE_SELECT = {
  id: true,
  name: true,
  provider: true,
  productLine: true,
  status: true,
  health: true,
  availableBalance: true,
  reservedBalance: true,
  lowBalanceThreshold: true,
  lowBalanceSince: true,
  priority: true,
  costPerUnit: true,
  consecutiveFailures: true,
  lastHealthCheckAt: true,
  updatedAt: true,
} as const;

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

@Injectable()
export class PrismaSourceManagementRepository implements SourceManagementRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<SourceRecord[]> {
    const rows = await this.prisma.fulfillmentSource.findMany({
      select: SOURCE_SELECT,
      orderBy: [{ priority: 'asc' }, { name: 'asc' }],
    });
    return rows.map(recordOf);
  }

  async find(id: string): Promise<SourceRecord | null> {
    const row = await this.prisma.fulfillmentSource.findUnique({
      where: { id },
      select: SOURCE_SELECT,
    });
    return row ? recordOf(row) : null;
  }

  async create(
    fields: SourceFields & {
      provider: string;
      productLine: ProductLineName;
      openingBalance: bigint;
    },
    requestId: string | null,
  ): Promise<SourceRecord | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const source = await tx.fulfillmentSource.create({
          data: {
            name: fields.name,
            provider: fields.provider,
            productLine: fields.productLine,
            priority: fields.priority,
            lowBalanceThreshold: fields.lowBalanceThreshold,
            costPerUnit: fields.costPerUnit,
            availableBalance: fields.openingBalance,
            // Out of routing until a person turns it on and its provider answers.
            status: 'DISABLED',
            health: 'UNKNOWN',
            currency: 'IDR',
          },
          select: { id: true },
        });
        if (fields.openingBalance > 0n) {
          await tx.sourceBalanceLog.create({
            data: {
              sourceId: source.id,
              reason: 'ADJUSTMENT',
              deltaAvailable: fields.openingBalance,
              deltaReserved: 0n,
              availableAfter: fields.openingBalance,
              reservedAfter: 0n,
              note: 'Opening balance',
              requestId,
            },
          });
        }
        await markLowBalanceIfCrossed(tx, source.id, requestId);
        return this.read(tx, source.id);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return null;
      }
      throw error;
    }
  }

  async update(
    id: string,
    fields: SourceFields,
    requestId: string | null,
  ): Promise<SourceRecord | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.fulfillmentSource.update({
          where: { id },
          data: {
            name: fields.name,
            priority: fields.priority,
            lowBalanceThreshold: fields.lowBalanceThreshold,
            costPerUnit: fields.costPerUnit,
          },
        });
        // A new threshold can put the source into, or take it out of, the low state.
        await markLowBalanceIfCrossed(tx, id, requestId);
        await clearLowBalanceIfRecovered(tx, id);
        return this.read(tx, id);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return null;
      }
      throw error;
    }
  }

  async setStatus(id: string, status: SourceStatus): Promise<SourceRecord> {
    await this.prisma.fulfillmentSource.update({ where: { id }, data: { status } });
    return (await this.find(id))!;
  }

  async adjust(
    id: string,
    delta: bigint,
    note: string,
    requestId: string | null,
  ): Promise<SourceRecord | null> {
    return this.prisma.$transaction(async (tx) => {
      // Conditional: a write-off can only take what is available, never reserved inventory.
      const [source] = await tx.$queryRaw<
        { available_balance: bigint; reserved_balance: bigint }[]
      >`
        UPDATE fulfillment_sources
           SET available_balance = available_balance + ${delta}, updated_at = now()
         WHERE id = ${id}::uuid AND available_balance + ${delta} >= 0
     RETURNING available_balance, reserved_balance`;
      if (!source) {
        return null;
      }
      await tx.sourceBalanceLog.create({
        data: {
          sourceId: id,
          reason: 'ADJUSTMENT',
          deltaAvailable: delta,
          deltaReserved: 0n,
          availableAfter: source.available_balance,
          reservedAfter: source.reserved_balance,
          note,
          requestId,
        },
      });
      await markLowBalanceIfCrossed(tx, id, requestId);
      await clearLowBalanceIfRecovered(tx, id);
      return this.read(tx, id);
    });
  }

  private async read(tx: Tx, id: string): Promise<SourceRecord> {
    return recordOf(
      await tx.fulfillmentSource.findUniqueOrThrow({ where: { id }, select: SOURCE_SELECT }),
    );
  }
}

function recordOf(row: {
  id: string;
  name: string;
  provider: string;
  productLine: SourceRecord['productLine'];
  status: SourceRecord['status'];
  health: SourceRecord['health'];
  availableBalance: bigint;
  reservedBalance: bigint;
  lowBalanceThreshold: bigint;
  lowBalanceSince: Date | null;
  priority: number;
  costPerUnit: Prisma.Decimal | null;
  consecutiveFailures: number;
  lastHealthCheckAt: Date | null;
  updatedAt: Date;
}): SourceRecord {
  return { ...row, costPerUnit: row.costPerUnit?.toFixed(4) ?? null };
}
