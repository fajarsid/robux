/**
 * A gateway attempt closes this long before the order's payment deadline, so a payment made in
 * the last minute still reaches us (callback, verification) before the expiry sweep cancels the
 * order. Without the margin a customer could pay for an order that is cancelled moments later.
 */
export const CALLBACK_SETTLEMENT_MARGIN_MS = 5 * 60_000;

/** Shorter windows are refused: a customer cannot realistically finish a transfer in less. */
export const MIN_PAYMENT_WINDOW_MS = 5 * 60_000;

/**
 * Latest moment the gateway may accept payment for a new attempt, or null when the order's
 * remaining time is too short to open one.
 */
export function gatewayCloseDeadline(orderDeadline: Date | null, now: Date): Date | null {
  if (!orderDeadline) {
    return null;
  }
  const close = new Date(orderDeadline.getTime() - CALLBACK_SETTLEMENT_MARGIN_MS);
  return close.getTime() - now.getTime() >= MIN_PAYMENT_WINDOW_MS ? close : null;
}
