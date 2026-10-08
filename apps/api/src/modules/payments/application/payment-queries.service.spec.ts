import { ConfiguredPaymentGatewayRegistry, type PaymentGateway } from '../domain/payment-gateway';
import { PaymentQueriesService } from './payment-queries.service';

function provider(
  code: 'DUITKU' | 'TELEGRAM_STARS',
  methods: string[],
  requiresTelegramChat = false,
): PaymentGateway {
  return {
    code,
    requiresTelegramChat,
    enabledMethods: () => methods,
    createPayment: jest.fn(),
    verifyCallback: jest.fn(),
    getTransactionStatus: jest.fn(),
  } as unknown as PaymentGateway;
}

describe('PaymentQueriesService.enabledMethods', () => {
  it('hides Telegram-only methods from general customer checkout and exposes them to Telegram', () => {
    const registry = new ConfiguredPaymentGatewayRegistry([
      provider('DUITKU', ['SP']),
      provider('TELEGRAM_STARS', ['TELEGRAM_STARS'], true),
    ]);
    const queries = new PaymentQueriesService({} as never, {} as never, registry);
    expect(queries.enabledMethods()).toEqual({ methods: [{ code: 'SP' }] });
    expect(queries.enabledMethods('telegram')).toEqual({
      methods: [{ code: 'SP' }, { code: 'TELEGRAM_STARS' }],
    });
  });
});
