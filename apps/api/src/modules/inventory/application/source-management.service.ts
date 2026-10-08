import { Inject, Injectable } from '@nestjs/common';
import {
  type AdjustSourceBalanceRequest,
  type AdminSourceView,
  type CreateSourceRequest,
  ErrorCode,
  type UpdateSourceRequest,
} from '@robux/shared';
import { DomainError } from '../../../common/errors/domain-error';
import type { RequestContext } from '../../../common/http/request-context';
import type { AuditAction } from '../../../generated/prisma/enums';
import { RecordAuditEventService } from '../../audit/application/record-audit-event.service';
import type { AuthenticatedPrincipal } from '../../auth/domain/authenticated-principal';
import {
  SOURCE_MANAGEMENT_REPOSITORY,
  type SourceManagementRepository,
  type SourceRecord,
} from '../domain/source-management.repository';

const notFound = () => new DomainError(ErrorCode.NOT_FOUND, 'Sumber tidak ditemukan.');
const nameTaken = () =>
  new DomainError(ErrorCode.INVALID_SOURCE_STATE, 'Nama sumber sudah digunakan.');

/** Staff view; the cost per unit only for those who manage inventory. */
export function toAdminSourceView(source: SourceRecord, canSeeCost: boolean): AdminSourceView {
  return {
    id: source.id,
    name: source.name,
    provider: source.provider,
    productLine: source.productLine,
    status: source.status,
    health: source.health,
    availableBalance: source.availableBalance.toString(),
    reservedBalance: source.reservedBalance.toString(),
    lowBalanceThreshold: source.lowBalanceThreshold.toString(),
    lowBalance: source.lowBalanceSince !== null,
    lowBalanceSince: source.lowBalanceSince?.toISOString() ?? null,
    priority: source.priority,
    ...(canSeeCost ? { costPerUnit: source.costPerUnit } : {}),
    consecutiveFailures: source.consecutiveFailures,
    lastHealthCheckAt: source.lastHealthCheckAt?.toISOString() ?? null,
    updatedAt: source.updatedAt.toISOString(),
  };
}

/** Admin commands on fulfillment sources. Every successful change is audited. */
@Injectable()
export class SourceManagementService {
  constructor(
    @Inject(SOURCE_MANAGEMENT_REPOSITORY) private readonly sources: SourceManagementRepository,
    private readonly audit: RecordAuditEventService,
  ) {}

  list(): Promise<SourceRecord[]> {
    return this.sources.list();
  }

  async create(
    actor: AuthenticatedPrincipal,
    request: CreateSourceRequest,
    context: RequestContext,
  ): Promise<SourceRecord> {
    const created = await this.sources.create(
      {
        name: request.name,
        provider: request.provider,
        productLine: request.productLine,
        priority: request.priority,
        lowBalanceThreshold: BigInt(request.lowBalanceThreshold),
        costPerUnit: request.costPerUnit,
        openingBalance: BigInt(request.openingBalance),
      },
      context.requestId ?? null,
    );
    if (!created) {
      throw nameTaken();
    }
    await this.record(actor, context, 'SOURCE_CREATED', created.id, undefined, snapshot(created));
    return created;
  }

  async update(
    actor: AuthenticatedPrincipal,
    id: string,
    request: UpdateSourceRequest,
    context: RequestContext,
  ): Promise<SourceRecord> {
    const before = await this.existing(id);
    const updated = await this.sources.update(
      id,
      {
        name: request.name,
        priority: request.priority,
        lowBalanceThreshold: BigInt(request.lowBalanceThreshold),
        costPerUnit: request.costPerUnit,
      },
      context.requestId ?? null,
    );
    if (!updated) {
      throw nameTaken();
    }
    await this.record(actor, context, 'SOURCE_CHANGED', id, snapshot(before), snapshot(updated));
    return updated;
  }

  /** Kill switch. Turning a source off never cancels the allocations it already holds. */
  async setActive(
    actor: AuthenticatedPrincipal,
    id: string,
    active: boolean,
    context: RequestContext,
  ): Promise<SourceRecord> {
    const before = await this.existing(id);
    const target = active ? 'ACTIVE' : 'DISABLED';
    if (before.status === target) {
      return before;
    }
    const after = await this.sources.setStatus(id, target);
    await this.record(
      actor,
      context,
      active ? 'SOURCE_ENABLED' : 'SOURCE_DISABLED',
      id,
      { status: before.status },
      { status: after.status },
    );
    return after;
  }

  async adjust(
    actor: AuthenticatedPrincipal,
    id: string,
    request: AdjustSourceBalanceRequest,
    context: RequestContext,
  ): Promise<SourceRecord> {
    const before = await this.existing(id);
    const after = await this.sources.adjust(
      id,
      BigInt(request.delta),
      request.reason,
      context.requestId ?? null,
    );
    if (!after) {
      throw new DomainError(
        ErrorCode.INVALID_SOURCE_STATE,
        'Saldo tersedia tidak cukup untuk pengurangan ini.',
      );
    }
    await this.record(
      actor,
      context,
      'SOURCE_CHANGED',
      id,
      { availableBalance: before.availableBalance.toString() },
      {
        availableBalance: after.availableBalance.toString(),
        adjustment: request.delta,
        reason: request.reason,
      },
    );
    return after;
  }

  private async existing(id: string): Promise<SourceRecord> {
    const source = await this.sources.find(id);
    if (!source) {
      throw notFound();
    }
    return source;
  }

  private record(
    actor: AuthenticatedPrincipal,
    context: RequestContext,
    action: AuditAction,
    sourceId: string,
    before: Record<string, unknown> | undefined,
    after: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.record({
      action,
      result: 'SUCCESS',
      actorType: 'STAFF',
      actorUserId: actor.userId,
      actorRole: actor.role,
      resourceType: 'fulfillment_source',
      resourceId: sourceId,
      before,
      after,
      ipAddress: context.ipAddress,
      requestId: context.requestId,
    });
  }
}

function snapshot(source: SourceRecord): Record<string, unknown> {
  return {
    name: source.name,
    provider: source.provider,
    productLine: source.productLine,
    priority: source.priority,
    lowBalanceThreshold: source.lowBalanceThreshold.toString(),
    costPerUnit: source.costPerUnit,
    availableBalance: source.availableBalance.toString(),
  };
}
