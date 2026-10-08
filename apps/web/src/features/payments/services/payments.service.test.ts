import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { apiGet, apiSend } from '@/lib/api/browser-api';
import { guestAccess, order, payment } from '../testing/payment-fixtures';
import { paymentsService } from './payments.service';

vi.mock('@/lib/api/browser-api', () => ({ apiGet: vi.fn(), apiSend: vi.fn() }));

const get = vi.mocked(apiGet);
const send = vi.mocked(apiSend);

function respond(stage: typeof order.stage, latest: unknown) {
  get.mockImplementation(async (path: string) => {
    if (path.endsWith('/payment')) {
      if (latest instanceof Error) {
        throw latest;
      }
      return latest;
    }
    return { ...order, stage };
  });
}

describe('paymentsService', () => {
  beforeEach(() => {
    get.mockReset();
    send.mockReset();
  });

  it('reads the order and its latest payment through the guest tracking route', async () => {
    respond('AWAITING_PAYMENT', payment());
    const state = await paymentsService.state(guestAccess);
    expect(get).toHaveBeenCalledWith(`/track/${guestAccess.trackingToken}`);
    expect(get).toHaveBeenCalledWith(`/track/${guestAccess.trackingToken}/payment`);
    expect(state).toEqual({
      orderStage: 'AWAITING_PAYMENT',
      payment: payment(),
      canCreatePayment: false,
    });
  });

  it('uses the customer route for signed-in owners', async () => {
    respond('AWAITING_PAYMENT', payment());
    await paymentsService.state({ kind: 'customer', orderId: 'o-1' });
    expect(get).toHaveBeenCalledWith('/me/orders/o-1/payment');
  });

  it('treats PAYMENT_NOT_FOUND as "no attempt yet" and offers to start one', async () => {
    respond('AWAITING_PAYMENT', new ApiError(404, 'PAYMENT_NOT_FOUND', ''));
    const state = await paymentsService.state(guestAccess);
    expect(state.payment).toBeNull();
    expect(state.canCreatePayment).toBe(true);
  });

  it('offers a new attempt only for a closed attempt on an order still awaiting payment', async () => {
    respond('AWAITING_PAYMENT', payment({ status: 'EXPIRED' }));
    expect((await paymentsService.state(guestAccess)).canCreatePayment).toBe(true);
    respond('CANCELLED', payment({ status: 'EXPIRED' }));
    expect((await paymentsService.state(guestAccess)).canCreatePayment).toBe(false);
    respond('PROCESSING', payment({ status: 'PAID' }));
    expect((await paymentsService.state(guestAccess)).canCreatePayment).toBe(false);
  });

  it('propagates access errors instead of hiding them', async () => {
    respond('AWAITING_PAYMENT', new ApiError(404, 'ORDER_NOT_FOUND', ''));
    await expect(paymentsService.state(guestAccess)).rejects.toMatchObject({
      code: 'ORDER_NOT_FOUND',
    });
  });

  it('creates a payment with the method only, under the given idempotency key', async () => {
    respond('AWAITING_PAYMENT', payment());
    send.mockResolvedValue(payment());
    const state = await paymentsService.create(guestAccess, { paymentMethod: 'AA' }, 'key-123');
    expect(send).toHaveBeenCalledWith(
      'POST',
      `/track/${guestAccess.trackingToken}/payment`,
      { paymentMethod: 'AA' },
      { 'Idempotency-Key': 'key-123' },
    );
    expect(state.payment?.status).toBe('PENDING');
  });

  it('lists the methods the API returns, keyed by their code', async () => {
    get.mockResolvedValue({ methods: [{ code: 'AA' }, { code: 'CC' }] });
    expect(await paymentsService.methods()).toEqual([
      { id: 'AA', name: 'AA', available: true },
      { id: 'CC', name: 'CC', available: true },
    ]);
    expect(get).toHaveBeenCalledWith('/payments/methods');
  });
});
