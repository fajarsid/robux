import { createPaymentRequestSchema } from '@robux/shared';

describe('createPaymentRequestSchema', () => {
  it('accepts both existing Duitku codes and the explicit Telegram Stars method', () => {
    expect(createPaymentRequestSchema.parse({ paymentMethod: 'SP' })).toEqual({
      paymentMethod: 'SP',
    });
    expect(createPaymentRequestSchema.parse({ paymentMethod: 'TELEGRAM_STARS' })).toEqual({
      paymentMethod: 'TELEGRAM_STARS',
    });
  });

  it('rejects arbitrary long provider or client-defined methods', () => {
    expect(createPaymentRequestSchema.safeParse({ paymentMethod: 'CLIENT_CHOOSES' }).success).toBe(
      false,
    );
    expect(createPaymentRequestSchema.safeParse({ paymentMethod: 'XTR' }).success).toBe(false);
  });
});
