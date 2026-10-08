import type { PaymentView } from '@robux/shared';
import type { Response } from 'express';
import type { PaymentCreationOutcome } from '../application/create-payment.service';

/** 201 for a new or replayed attempt (as order creation), 200 when the live attempt is returned. */
export function sendPaymentCreation(
  res: Response,
  result: { payment: PaymentView; outcome: PaymentCreationOutcome },
): PaymentView {
  res.status(result.outcome === 'REUSED' ? 200 : 201);
  res.setHeader('Cache-Control', 'no-store');
  if (result.outcome === 'REPLAYED') {
    res.setHeader('Idempotent-Replayed', 'true');
  }
  return result.payment;
}
