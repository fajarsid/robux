import { MockPaymentGateway } from './mock-payment.gateway';

describe('MockPaymentGateway', () => {
  it('creates a deterministic local attempt and verifies controlled outcomes', async () => {
    const gateway = new MockPaymentGateway();
    const request = {
      merchantOrderId: 'TG-10001-1', amount: '150000.00', currency: 'IDR', paymentMethod: 'MK',
      customerEmail: 'buyer@example.test', orderNumber: 'TG-10001', description: 'Telegram Account',
      closeNoLaterThan: new Date('2026-10-09T00:00:00Z'), now: new Date('2026-10-08T00:00:00Z'),
    };
    const created = await gateway.createPayment(request);
    expect(created.paymentUrl).toContain('payment.invalid');
    expect(gateway.enabledMethods()).toEqual(['MK']);

    const callback = gateway.simulate(request.merchantOrderId, 'PAID');
    expect(gateway.verifyCallback(callback).eventKey).toBe('TG-10001-1:PAID');
    await expect(gateway.getTransactionStatus(request.merchantOrderId)).resolves.toMatchObject({
      outcome: 'PAID', amount: request.amount, currency: 'IDR',
    });
    await expect(gateway.createPayment(request)).resolves.toEqual(created);
  });

  it('rejects altered callbacks and does not allow conflicting settlement', async () => {
    const gateway = new MockPaymentGateway();
    const request = {
      merchantOrderId: 'TG-10002-1', amount: '50000.00', currency: 'IDR', paymentMethod: 'MK',
      customerEmail: 'buyer@example.test', orderNumber: 'TG-10002', description: 'Account',
      closeNoLaterThan: new Date(Date.now() + 60_000), now: new Date(),
    };
    await gateway.createPayment(request);
    const callback = gateway.simulate(request.merchantOrderId, 'PAID');
    callback.fields.amount = '1.00';
    expect(() => gateway.verifyCallback(callback)).toThrow();
    expect(() => gateway.simulate(request.merchantOrderId, 'FAILED')).toThrow(/already settled/);
  });
});
