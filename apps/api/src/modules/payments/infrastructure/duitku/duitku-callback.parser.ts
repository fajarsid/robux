import type { DuitkuConfig } from '../../../../config/payments-config';
import {
  CallbackRejectedError,
  type RawCallback,
  type VerifiedCallback,
} from '../../domain/payment-gateway';
import { constantTimeEquals, duitkuSignature } from './duitku-signature';

const FORM_CONTENT_TYPE = 'application/x-www-form-urlencoded';

const REQUIRED_FORMATS = {
  merchantCode: /^[\x21-\x7E]{1,50}$/,
  amount: /^\d{1,16}(\.\d{1,2})?$/,
  merchantOrderId: /^[\x21-\x7E]{1,50}$/,
  resultCode: /^\d{2}$/,
  reference: /^[\x21-\x7E]{1,255}$/,
  signature: /^[0-9a-fA-F]{64}$/,
} as const;

/**
 * Kept in webhook_events for support. The signature and customer data (merchantUserId,
 * customerName, spUserHash) are deliberately dropped.
 */
const STORED_OPTIONAL_FIELDS = ['paymentCode', 'publisherOrderId', 'settlementDate', 'issuerCode'];

type RequiredField = keyof typeof REQUIRED_FORMATS;

function normalizeIp(ip: string): string {
  return ip.replace(/^::ffff:/, '');
}

/**
 * Validates a Duitku callback (docs/integrations/duitku.md §4): form encoding, required fields,
 * merchant code and HMAC signature. Duitku does not sign resultCode or reference, so the result
 * only tells the caller which payment to verify; it is never trusted as a payment status.
 */
export function parseDuitkuCallback(config: DuitkuConfig, raw: RawCallback): VerifiedCallback {
  if (
    config.callbackAllowedIps.length > 0 &&
    !config.callbackAllowedIps.includes(normalizeIp(raw.sourceIp))
  ) {
    throw new CallbackRejectedError('SOURCE_NOT_ALLOWED');
  }
  if (!raw.contentType?.toLowerCase().startsWith(FORM_CONTENT_TYPE)) {
    throw new CallbackRejectedError('MALFORMED');
  }

  const fields = {} as Record<RequiredField, string>;
  for (const [name, format] of Object.entries(REQUIRED_FORMATS) as [RequiredField, RegExp][]) {
    const value = raw.fields[name];
    if (typeof value !== 'string' || !format.test(value)) {
      throw new CallbackRejectedError('MALFORMED');
    }
    fields[name] = value;
  }

  const expected = duitkuSignature(
    config.apiKey,
    fields.merchantCode,
    fields.amount,
    fields.merchantOrderId,
  );
  const merchantMatches = constantTimeEquals(fields.merchantCode, config.merchantCode);
  const signatureMatches = constantTimeEquals(fields.signature.toLowerCase(), expected);
  if (!merchantMatches || !signatureMatches) {
    throw new CallbackRejectedError('SIGNATURE_INVALID');
  }

  const payload: Record<string, string> = {
    merchantCode: fields.merchantCode,
    amount: fields.amount,
    merchantOrderId: fields.merchantOrderId,
    resultCode: fields.resultCode,
    reference: fields.reference,
  };
  for (const name of STORED_OPTIONAL_FIELDS) {
    const value = raw.fields[name];
    if (typeof value === 'string' && value.length > 0) {
      payload[name] = value.slice(0, 255);
    }
  }
  const paymentCode = payload.paymentCode;

  return {
    merchantOrderId: fields.merchantOrderId,
    gatewayReference: fields.reference,
    amount: fields.amount,
    paymentMethod: paymentCode && /^[A-Z0-9]{2}$/.test(paymentCode) ? paymentCode : null,
    eventKey: `${fields.merchantOrderId}:${fields.reference}:${fields.resultCode}`,
    payload,
  };
}
