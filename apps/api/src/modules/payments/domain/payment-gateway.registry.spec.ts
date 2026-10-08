import { ConfiguredPaymentGatewayRegistry } from './payment-gateway';
import type { PaymentGateway } from './payment-gateway';

describe('ConfiguredPaymentGatewayRegistry', () => {
  const gateway = (code: 'DUITKU' | 'TELEGRAM_STARS', methods: string[]) => ({
    code,
    enabledMethods: () => methods,
    createPayment: jest.fn(),
    verifyCallback: jest.fn(),
    getTransactionStatus: jest.fn(),
  }) as unknown as PaymentGateway;

  it('routes a selected method and persisted provider independently', () => {
    const duitku = gateway('DUITKU', ['QRIS', 'VA'] );
    const stars = gateway('TELEGRAM_STARS', ['XTR']);
    const registry = new ConfiguredPaymentGatewayRegistry([duitku, stars]);

    expect(registry.enabledMethods()).toEqual(['QRIS', 'VA', 'XTR']);
    expect(registry.forMethod('XTR')).toBe(stars);
    expect(registry.byCode('DUITKU')).toBe(duitku);
  });

  it('fails closed when providers claim the same method or provider code', () => {
    expect(() => new ConfiguredPaymentGatewayRegistry([
      gateway('DUITKU', ['QRIS']), gateway('TELEGRAM_STARS', ['QRIS']),
    ])).toThrow('Duplicate payment method: QRIS');
    expect(() => new ConfiguredPaymentGatewayRegistry([
      gateway('DUITKU', ['QRIS']), gateway('DUITKU', ['VA']),
    ])).toThrow('Duplicate payment gateway: DUITKU');
  });
});
