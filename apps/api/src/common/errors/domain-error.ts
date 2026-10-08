import { ErrorCode } from '@robux/shared';

/**
 * A business-rule failure raised by domain or application code. It carries no HTTP knowledge;
 * the global exception filter maps the code to a status (DOMAIN_ERROR_STATUS).
 */
export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export const DOMAIN_ERROR_STATUS: Partial<Record<ErrorCode, number>> = {
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.VALIDATION_FAILED]: 400,
  [ErrorCode.QUANTITY_OUT_OF_RANGE]: 400,
  [ErrorCode.PRICING_RULE_VIOLATION]: 400,
  [ErrorCode.PRICE_VERSION_CONFLICT]: 409,
  [ErrorCode.INVALID_PRODUCT_STATE]: 409,
  [ErrorCode.INVALID_SOURCE_STATE]: 409,
  [ErrorCode.PRODUCT_INACTIVE]: 409,
  [ErrorCode.PRODUCT_NOT_FOUND]: 404,
  [ErrorCode.PRODUCT_UNAVAILABLE]: 409,
  [ErrorCode.PRICE_CHANGED]: 409,
  [ErrorCode.IDEMPOTENCY_KEY_REQUIRED]: 400,
  [ErrorCode.DUPLICATE_IDEMPOTENCY_KEY]: 422,
  [ErrorCode.ORDER_NOT_FOUND]: 404,
  [ErrorCode.ORDER_NOT_CANCELLABLE]: 409,
  [ErrorCode.INVALID_ORDER_TRANSITION]: 409,
  [ErrorCode.STAFF_CANNOT_ORDER]: 403,
  [ErrorCode.ORDER_NOT_PAYABLE]: 409,
  [ErrorCode.PAYMENT_NOT_FOUND]: 404,
  [ErrorCode.PAYMENT_METHOD_UNAVAILABLE]: 400,
  [ErrorCode.PAYMENT_ALREADY_PENDING]: 409,
  [ErrorCode.PAYMENT_IN_PROGRESS]: 409,
  [ErrorCode.PAYMENT_GATEWAY_UNAVAILABLE]: 503,
  [ErrorCode.PAYMENT_GATEWAY_REJECTED]: 502,
  [ErrorCode.PAYMENT_AMOUNT_MISMATCH]: 409,
  [ErrorCode.WEBHOOK_PAYLOAD_INVALID]: 400,
  [ErrorCode.WEBHOOK_SIGNATURE_INVALID]: 401,
};
