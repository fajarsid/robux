import { GatewayRejectedError, type GatewayPaymentRequest } from '../../domain/payment-gateway';
import { TelegramStarsPaymentGateway } from './telegram-stars-payment.gateway';

const request: GatewayPaymentRequest = {
  merchantOrderId: 'TG-10001-1',
  amount: '150.00',
  currency: 'XTR',
  telegramChatId: '12345',
  paymentMethod: 'TELEGRAM_STARS',
  customerEmail: '',
  orderNumber: 'TG-10001',
  description: 'Telegram Account',
  closeNoLaterThan: new Date('2026-10-08T12:00:00Z'),
  now: new Date('2026-10-08T11:00:00Z'),
};

describe('TelegramStarsPaymentGateway', () => {
  it('creates an XTR invoice without a provider token and waits for Telegram charge reference', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true, result: { message_id: 77 } }), { status: 200 }),
      );
    const gateway = new TelegramStarsPaymentGateway('test-token', fetchImpl);
    const created = await gateway.createPayment(request);
    const sent = JSON.parse(fetchImpl.mock.calls[0][1].body as string) as Record<string, unknown>;
    expect(fetchImpl.mock.calls[0][0]).toContain('/sendInvoice');
    expect(sent).toMatchObject({
      chat_id: '12345',
      currency: 'XTR',
      payload: 'TG-10001-1',
      prices: [{ amount: 150 }],
    });
    expect(sent).not.toHaveProperty('provider_token');
    expect(created).toMatchObject({ gatewayReference: null, paymentUrl: null });
  });

  it('accepts the successful_payment update as the charge reference and XTR claim', () => {
    const gateway = new TelegramStarsPaymentGateway('test-token');
    expect(
      gateway.verifyCallback({
        contentType: 'application/json',
        sourceIp: '',
        fields: {
          message: {
            successful_payment: {
              invoice_payload: 'TG-10001-1',
              telegram_payment_charge_id: 'charge-1',
              total_amount: 150,
              currency: 'XTR',
            },
          },
        },
      }),
    ).toMatchObject({
      merchantOrderId: 'TG-10001-1',
      gatewayReference: 'charge-1',
      amount: '150',
      paymentMethod: 'TELEGRAM_STARS',
    });
  });

  it('accepts Bot API boolean results for pre-checkout responses', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true, result: true }), { status: 200 }));
    await new TelegramStarsPaymentGateway('test-token', fetchImpl).answerPreCheckout(
      'query-1',
      true,
    );
    expect(fetchImpl.mock.calls[0][0]).toContain('/answerPreCheckoutQuery');
  });

  it('rejects missing or fractional XTR pricing instead of converting IDR', () => {
    const gateway = new TelegramStarsPaymentGateway('test-token');
    expect(() =>
      gateway.settlementAmount({ total: '150000', currency: 'IDR', starsAmount: null }),
    ).toThrow(GatewayRejectedError);
    expect(() =>
      gateway.settlementAmount({ total: '150000', currency: 'IDR', starsAmount: 1.5 }),
    ).toThrow(GatewayRejectedError);
  });
});
