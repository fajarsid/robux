import type { OrderStatus } from '../../../generated/prisma/enums';
import type {
  OrderLifecycleState,
  OrderStatusTransition,
  OrderStatusTransitionRepository,
} from '../domain/order-status-transition.repository';
import { QueuePaidOrderService } from './queue-paid-order.service';

const ORDER_ID = '0192f0a0-0000-7000-8000-000000000001';
const trigger = { outboxEventId: '0192f0a0-0000-7000-8000-0000000000e1', requestId: 'req-1' };

/** In-memory repository with the same conditional-update semantics as the Prisma one. */
function repository(initial: OrderStatus | null) {
  let status = initial;
  const applied: OrderStatusTransition[] = [];
  const repo: OrderStatusTransitionRepository = {
    apply: async (transition) => {
      if (status !== transition.from) {
        return { applied: false, reason: 'STATUS_CHANGED_CONCURRENTLY' };
      }
      status = transition.to;
      applied.push(transition);
      return { applied: true };
    },
    findState: async (): Promise<OrderLifecycleState | null> =>
      status ? { id: ORDER_ID, orderNumber: 'RBX-20261005-00001', status, userId: null } : null,
    findStateByTrackingTokenHash: async () => null,
    dueForPaymentExpiry: async () => [],
  };
  return { repo, applied, setStatus: (next: OrderStatus) => (status = next) };
}

describe('QueuePaidOrderService', () => {
  it('moves a paid order to QUEUED and requests fulfillment in the same transition', async () => {
    const { repo, applied } = repository('PAID');
    expect(await new QueuePaidOrderService(repo).queue(ORDER_ID, trigger)).toBe('QUEUED');
    expect(applied).toEqual([
      expect.objectContaining({
        from: 'PAID',
        to: 'QUEUED',
        actorType: 'SYSTEM',
        outboxEventType: 'FULFILLMENT_REQUESTED',
        requestId: 'req-1',
        metadata: { outboxEventId: trigger.outboxEventId },
      }),
    ]);
  });

  it('changes nothing when the same event is processed again', async () => {
    const { repo, applied } = repository('PAID');
    const service = new QueuePaidOrderService(repo);
    await service.queue(ORDER_ID, trigger);
    expect(await service.queue(ORDER_ID, trigger)).toBe('ALREADY_QUEUED');
    expect(applied).toHaveLength(1);
  });

  it.each<OrderStatus>(['PROCESSING', 'FULFILLED', 'FAILED_PERMANENTLY'])(
    'treats an order already in fulfillment (%s) as done',
    async (status) => {
      const { repo, applied } = repository(status);
      expect(await new QueuePaidOrderService(repo).queue(ORDER_ID, trigger)).toBe('ALREADY_QUEUED');
      expect(applied).toHaveLength(0);
    },
  );

  it.each<OrderStatus>(['REFUND_PENDING', 'RECONCILIATION_REQUIRED', 'CANCELLED'])(
    'leaves an order that left PAID another way (%s) untouched',
    async (status) => {
      const { repo, applied } = repository(status);
      expect(await new QueuePaidOrderService(repo).queue(ORDER_ID, trigger)).toBe('NOT_ELIGIBLE');
      expect(applied).toHaveLength(0);
    },
  );

  it('reports a lost race as already queued', async () => {
    const { repo, setStatus } = repository('PAID');
    const racing: OrderStatusTransitionRepository = {
      ...repo,
      // Another worker moves the order between our read and our conditional update.
      apply: async (transition) => {
        setStatus('QUEUED');
        return repo.apply(transition);
      },
    };
    expect(await new QueuePaidOrderService(racing).queue(ORDER_ID, trigger)).toBe('ALREADY_QUEUED');
  });

  it('reports an unknown order', async () => {
    const { repo } = repository(null);
    expect(await new QueuePaidOrderService(repo).queue(ORDER_ID, trigger)).toBe('ORDER_NOT_FOUND');
  });
});
