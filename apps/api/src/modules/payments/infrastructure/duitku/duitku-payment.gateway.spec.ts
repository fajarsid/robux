import type { DuitkuConfig } from '../../../../config/payments-config';
import {
  GatewayRejectedError,
  type GatewayPaymentRequest,
  GatewayUnavailableError,
} from '../../domain/payment-gateway';
import { DuitkuPaymentGateway } from './duitku-payment.gateway';
import { duitkuSignature } from './duitku-signature';

const config: DuitkuConfig = {
  environment: 'sandbox',
  merchantCode: 'DTEST',
  apiKey: 'unit-test-key',
  callbackUrl: 'https://api.example.test/api/v1/webhooks/payments/duitku',
  returnUrl: 'https://app.example.test/payment/return',
  paymentMethods: ['BC', 'SP', 'LF'],
  callbackAllowedIps: [],
  requestTimeoutMs: 5000,
};

const now = new Date('2026-10-05T10:00:00Z');

function paymentRequest(overrides: Partial<GatewayPaymentRequest> = {}): GatewayPaymentRequest {
  return {
    merchantOrderId: 'RBX-20261005-00001-1',
    amount: '138000.00',
    currency: 'IDR',
    paymentMethod: 'BC',
    customerEmail: 'buyer@example.test',
    orderNumber: 'RBX-20261005-00001',
    description: 'Robux 500 x2',
    closeNoLaterThan: new Date(now.getTime() + 55 * 60_000),
    now,
    ...overrides,
  };
}

interface Call {
  url: string;
  body: Record<string, unknown>;
}

function fakeFetch(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), body: JSON.parse(String(init?.body)) };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const inquiryOk = (call: Call) =>
  json({
    merchantCode: 'DTEST',
    reference: 'DTESTREF1',
    paymentUrl: 'https://sandbox.duitku.com/topup/topupdirectv2.aspx?ref=DTESTREF1',
    amount: String(call.body.paymentAmount),
    statusCode: '00',
    statusMessage: 'SUCCESS',
  });

describe('DuitkuPaymentGateway', () => {
  it('refuses to start with a method it cannot serve', () => {
    expect(() => new DuitkuPaymentGateway({ ...config, paymentMethods: ['BC', 'VC'] })).toThrow(
      /unsupported codes VC/,
    );
  });

  describe('createPayment', () => {
    it('preserves the documented QR payload for QRIS while ignoring it for other methods', async () => {
      const { fetchImpl } = fakeFetch((call) =>
        json({
          merchantCode: 'DTEST',
          reference: 'DTESTREF1',
          paymentUrl: 'https://sandbox.duitku.com/topup/topupdirectv2.aspx?ref=DTESTREF1',
          qrString: '000201010212TEST-QR-PAYLOAD',
          amount: String(call.body.paymentAmount),
          statusCode: '00',
        }),
      );
      const gateway = new DuitkuPaymentGateway(config, fetchImpl);
      await expect(
        gateway.createPayment(paymentRequest({ paymentMethod: 'SP' })),
      ).resolves.toMatchObject({ qrPayload: '000201010212TEST-QR-PAYLOAD' });
      await expect(
        gateway.createPayment(paymentRequest({ paymentMethod: 'BC' })),
      ).resolves.not.toHaveProperty('qrPayload');
    });

    it('sends the documented inquiry with an HMAC-SHA256 signature', async () => {
      const { calls, fetchImpl } = fakeFetch(inquiryOk);
      const created = await new DuitkuPaymentGateway(config, fetchImpl).createPayment(
        paymentRequest(),
      );

      expect(calls[0]!.url).toBe('https://sandbox.duitku.com/webapi/api/merchant/v2/inquiry');
      expect(calls[0]!.body).toEqual({
        merchantCode: 'DTEST',
        paymentAmount: 138000,
        paymentMethod: 'BC',
        merchantOrderId: 'RBX-20261005-00001-1',
        productDetails: 'Robux 500 x2',
        email: 'buyer@example.test',
        customerVaName: 'RBX-20261005-00001',
        itemDetails: [{ name: 'Robux 500 x2', price: 138000, quantity: 1 }],
        callbackUrl: config.callbackUrl,
        returnUrl: config.returnUrl,
        signature: duitkuSignature('unit-test-key', 'DTEST', 'RBX-20261005-00001-1', '138000'),
        expiryPeriod: 55,
      });
      expect(created).toEqual({
        gatewayReference: 'DTESTREF1',
        paymentUrl: 'https://sandbox.duitku.com/topup/topupdirectv2.aspx?ref=DTESTREF1',
        expiresAt: new Date(now.getTime() + 55 * 60_000),
      });
    });

    it('uses the production host in production', async () => {
      const { calls, fetchImpl } = fakeFetch(inquiryOk);
      await new DuitkuPaymentGateway(
        { ...config, environment: 'production' },
        fetchImpl,
      ).createPayment(paymentRequest());
      expect(calls[0]!.url).toBe('https://passport.duitku.com/webapi/api/merchant/v2/inquiry');
    });

    it('caps the expiry at the method maximum', async () => {
      const { calls, fetchImpl } = fakeFetch(inquiryOk);
      const created = await new DuitkuPaymentGateway(config, fetchImpl).createPayment(
        paymentRequest({
          paymentMethod: 'SP',
          closeNoLaterThan: new Date(now.getTime() + 600 * 60_000),
        }),
      );
      expect(calls[0]!.body.expiryPeriod).toBe(60);
      expect(created.expiresAt).toEqual(new Date(now.getTime() + 60 * 60_000));
    });

    it('refuses a fixed-window method that would outlast the allowed window', async () => {
      const { calls, fetchImpl } = fakeFetch(inquiryOk);
      const gateway = new DuitkuPaymentGateway(config, fetchImpl);
      await expect(
        gateway.createPayment(
          paymentRequest({
            paymentMethod: 'LF',
            closeNoLaterThan: new Date(now.getTime() + 20 * 60_000),
          }),
        ),
      ).rejects.toMatchObject({ reason: 'WINDOW_TOO_SHORT' });
      expect(calls).toHaveLength(0);
    });

    it.each([
      ['a disabled method', { paymentMethod: 'M2' }, 'METHOD_UNAVAILABLE'],
      ['a fractional amount', { amount: '1000.50' }, 'REQUEST_REFUSED'],
      ['another currency', { currency: 'USD' }, 'REQUEST_REFUSED'],
      [
        'an email Duitku rejects',
        { customerEmail: `${'a'.repeat(45)}@example.test` },
        'REQUEST_REFUSED',
      ],
    ])('refuses %s before calling Duitku', async (_name, overrides, reason) => {
      const { calls, fetchImpl } = fakeFetch(inquiryOk);
      await expect(
        new DuitkuPaymentGateway(config, fetchImpl).createPayment(paymentRequest(overrides)),
      ).rejects.toMatchObject({ reason });
      expect(calls).toHaveLength(0);
    });

    it('treats a 4xx answer as a definite refusal', async () => {
      const { fetchImpl } = fakeFetch(() =>
        json({ Message: 'Payment channel not available' }, 404),
      );
      await expect(
        new DuitkuPaymentGateway(config, fetchImpl).createPayment(paymentRequest()),
      ).rejects.toBeInstanceOf(GatewayRejectedError);
    });

    it.each([
      ['a 5xx answer', () => json({}, 502)],
      ['a network error', () => Promise.reject(new TypeError('fetch failed'))],
      ['an unreadable body', () => new Response('<html>', { status: 200 })],
      [
        'a non-success status code',
        () =>
          json({
            reference: 'R',
            paymentUrl: 'https://x.test',
            amount: '138000',
            statusCode: '01',
          }),
      ],
      [
        'a non-https payment URL',
        () => json({ reference: 'R', paymentUrl: 'javascript:alert(1)', statusCode: '00' }),
      ],
      [
        'a different echoed amount',
        () => json({ reference: 'R', paymentUrl: 'https://x.test', amount: '1', statusCode: '00' }),
      ],
    ])('treats %s as an unknown outcome', async (_name, respond) => {
      const { fetchImpl } = fakeFetch(respond as (call: Call) => Response);
      await expect(
        new DuitkuPaymentGateway(config, fetchImpl).createPayment(paymentRequest()),
      ).rejects.toBeInstanceOf(GatewayUnavailableError);
    });
  });

  describe('getTransactionStatus', () => {
    it.each([
      ['00', 'PAID'],
      ['01', 'PENDING'],
      ['02', 'FAILED_OR_EXPIRED'],
    ])('maps status %s to %s', async (statusCode, outcome) => {
      const { calls, fetchImpl } = fakeFetch(() =>
        json({
          merchantOrderId: 'RBX-20261005-00001-1',
          reference: 'DTESTREF1',
          amount: '138000',
          fee: '0.00',
          statusCode,
          statusMessage: 'X',
        }),
      );
      const status = await new DuitkuPaymentGateway(config, fetchImpl).getTransactionStatus(
        'RBX-20261005-00001-1',
      );
      expect(calls[0]!.url).toBe(
        'https://sandbox.duitku.com/webapi/api/merchant/transactionStatus',
      );
      expect(calls[0]!.body).toEqual({
        merchantCode: 'DTEST',
        merchantOrderId: 'RBX-20261005-00001-1',
        signature: duitkuSignature('unit-test-key', 'DTEST', 'RBX-20261005-00001-1'),
      });
      expect(status).toEqual({
        merchantOrderId: 'RBX-20261005-00001-1',
        gatewayReference: 'DTESTREF1',
        amount: '138000',
        currency: 'IDR',
        outcome,
        rawStatus: statusCode,
      });
    });

    it('treats an undocumented status code as unknown', async () => {
      const { fetchImpl } = fakeFetch(() => json({ statusCode: '99', amount: '1' }));
      await expect(
        new DuitkuPaymentGateway(config, fetchImpl).getTransactionStatus('X'),
      ).rejects.toBeInstanceOf(GatewayUnavailableError);
    });
  });
});
