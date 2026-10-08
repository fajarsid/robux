import type { OrderAccess } from './types/payment.types';

/** Customers use their account route; guests the private tracking route (D-03). */
export function orderHref(access: OrderAccess): string {
  return access.kind === 'guest'
    ? `/order/${encodeURIComponent(access.trackingToken)}`
    : `/account/orders/${encodeURIComponent(access.orderId)}`;
}

export function paymentHref(access: OrderAccess): string {
  return `${orderHref(access)}/payment`;
}

/**
 * Only HTTPS URLs may become a link or an image source. The customer is sent to the gateway with
 * this URL, so plain `http:` (interceptable) and `javascript:`/`data:`/`file:` from a misbehaving
 * upstream are dropped rather than rendered.
 */
export function safeExternalUrl(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function safeImageUrl(value: string | null | undefined): string | null {
  if (value?.startsWith('data:image/')) {
    return value;
  }
  return safeExternalUrl(value);
}
