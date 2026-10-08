import { randomBytes, randomUUID } from 'node:crypto';
import { duitkuSignature } from '../../../src/modules/payments/infrastructure/duitku/duitku-signature';

export const STUB_MERCHANT_CODE = 'DTEST';
// Generated per test run, so no secret-shaped literal lives in the repository.
export const STUB_API_KEY = randomBytes(16).toString('hex');

interface StubTransaction {
  merchantOrderId: string;
  reference: string;
  amount: string;
  statusCode: '00' | '01' | '02';
}

type Failure = { kind: 'http'; status: number } | { kind: 'network' };

/**
 * Local stand-in for the Duitku HTTP API, answering with the documented shapes
 * (docs/integrations/duitku.md §3, §5). It lets the real DuitkuPaymentGateway run in tests
 * without ever calling Duitku.
 */
export class DuitkuStub {
  readonly inquiries: Record<string, unknown>[] = [];
  readonly statusChecks: Record<string, unknown>[] = [];
  private readonly transactions = new Map<string, StubTransaction>();
  private inquiryFailure: Failure | null = null;
  private statusFailure: Failure | null = null;
  /** Overrides what Check Transaction reports, to simulate a gateway disagreeing with us. */
  private readonly statusOverrides = new Map<string, Partial<StubTransaction>>();

  readonly fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    const signed = (...parts: unknown[]) =>
      body.signature === duitkuSignature(STUB_API_KEY, ...parts.map(String));
    if (url.pathname.endsWith('/merchant/v2/inquiry')) {
      this.inquiries.push(body);
      if (!signed(body.merchantCode, body.merchantOrderId, body.paymentAmount)) {
        return new Response(JSON.stringify({ Message: 'Wrong signature' }), { status: 401 });
      }
      return this.respond(this.inquiryFailure, () => this.inquiry(body));
    }
    if (url.pathname.endsWith('/merchant/transactionStatus')) {
      this.statusChecks.push(body);
      if (!signed(body.merchantCode, body.merchantOrderId)) {
        return new Response(JSON.stringify({ Message: 'Wrong signature' }), { status: 401 });
      }
      return this.respond(this.statusFailure, () => this.status(body));
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;

  failInquiries(failure: Failure | null): void {
    this.inquiryFailure = failure;
  }

  failStatusChecks(failure: Failure | null): void {
    this.statusFailure = failure;
  }

  settle(merchantOrderId: string, statusCode: '00' | '01' | '02'): StubTransaction {
    const transaction = this.transaction(merchantOrderId);
    transaction.statusCode = statusCode;
    return transaction;
  }

  reportInstead(merchantOrderId: string, override: Partial<StubTransaction>): void {
    this.statusOverrides.set(merchantOrderId, override);
  }

  transaction(merchantOrderId: string): StubTransaction {
    const transaction = this.transactions.get(merchantOrderId);
    if (!transaction) {
      throw new Error(`No stub transaction ${merchantOrderId}`);
    }
    return transaction;
  }

  /** A callback form as Duitku posts it, signed with the stub project key unless told otherwise. */
  callbackForm(
    merchantOrderId: string,
    options: {
      resultCode?: string;
      amount?: string;
      reference?: string;
      merchantCode?: string;
      apiKey?: string;
      signature?: string | null;
    } = {},
  ): Record<string, string> {
    const transaction = this.transactions.get(merchantOrderId);
    const merchantCode = options.merchantCode ?? STUB_MERCHANT_CODE;
    const amount = options.amount ?? transaction?.amount ?? '10000';
    const form: Record<string, string> = {
      merchantCode,
      amount,
      merchantOrderId,
      productDetail: 'Test Robux x1',
      additionalParam: '',
      paymentCode: 'BC',
      resultCode: options.resultCode ?? '00',
      merchantUserId: 'buyer@example.test',
      reference: options.reference ?? transaction?.reference ?? 'DTESTUNKNOWN',
      publisherOrderId: 'PUB123',
      settlementDate: '2026-10-06',
      customerName: 'Bud**** Sant***',
    };
    if (options.signature !== null) {
      form.signature =
        options.signature ??
        duitkuSignature(options.apiKey ?? STUB_API_KEY, merchantCode, amount, merchantOrderId);
    }
    return form;
  }

  private inquiry(body: Record<string, unknown>) {
    const merchantOrderId = String(body.merchantOrderId);
    const reference = `DTEST${randomUUID().replace(/-/g, '').slice(0, 15).toUpperCase()}`;
    this.transactions.set(merchantOrderId, {
      merchantOrderId,
      reference,
      amount: String(body.paymentAmount),
      statusCode: '01',
    });
    return {
      merchantCode: body.merchantCode,
      reference,
      paymentUrl: `https://sandbox.duitku.com/topup/topupdirectv2.aspx?ref=${reference}`,
      vaNumber: '7007014001444348',
      amount: String(body.paymentAmount),
      statusCode: '00',
      statusMessage: 'SUCCESS',
    };
  }

  private status(body: Record<string, unknown>) {
    const merchantOrderId = String(body.merchantOrderId);
    const known = this.transactions.get(merchantOrderId);
    if (!known) {
      return { merchantOrderId, reference: '', amount: '0', fee: '0.00', statusCode: '02' };
    }
    const reported = { ...known, ...this.statusOverrides.get(merchantOrderId) };
    return {
      merchantOrderId: reported.merchantOrderId,
      reference: reported.reference,
      amount: reported.amount,
      fee: '0.00',
      statusCode: reported.statusCode,
      statusMessage: reported.statusCode === '00' ? 'SUCCESS' : 'PROCESS',
    };
  }

  private respond(failure: Failure | null, success: () => object): Response {
    if (failure?.kind === 'network') {
      throw new TypeError('fetch failed');
    }
    if (failure?.kind === 'http') {
      return new Response(JSON.stringify({ Message: 'stub failure' }), { status: failure.status });
    }
    return new Response(JSON.stringify(success()), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
