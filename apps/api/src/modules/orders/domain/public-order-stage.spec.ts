import { OrderStatus } from '../../../generated/prisma/enums';
import { toPublicOrderStage, toPublicTimeline } from './public-order-stage';

describe('public order stage', () => {
  it('maps every internal status to a public stage', () => {
    for (const status of Object.values(OrderStatus)) {
      expect(toPublicOrderStage(status)).toEqual(expect.any(String));
    }
  });

  it('hides internal failure and reconciliation states behind PROCESSING', () => {
    for (const status of [
      'FAILED',
      'RETRYING',
      'FAILED_PERMANENTLY',
      'RECONCILIATION_REQUIRED',
    ] as const) {
      expect(toPublicOrderStage(status)).toBe('PROCESSING');
    }
  });

  it('collapses consecutive statuses with the same stage into one timeline entry', () => {
    const at = (minute: number) => new Date(Date.UTC(2026, 9, 5, 10, minute));
    const timeline = toPublicTimeline([
      { toStatus: 'CREATED', createdAt: at(0) },
      { toStatus: 'PAYMENT_PENDING', createdAt: at(1) },
      { toStatus: 'PAID', createdAt: at(2) },
      { toStatus: 'QUEUED', createdAt: at(2) },
      { toStatus: 'RETRYING', createdAt: at(3) },
      { toStatus: 'FULFILLED', createdAt: at(4) },
    ]);
    expect(timeline).toEqual([
      { stage: 'AWAITING_PAYMENT', at: at(0).toISOString() },
      { stage: 'PROCESSING', at: at(2).toISOString() },
      { stage: 'COMPLETED', at: at(4).toISOString() },
    ]);
  });
});
