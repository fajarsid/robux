import { Inject, Injectable, Logger } from '@nestjs/common';
import { type CallbackClaim, assessGatewayStatus } from '../domain/payment-assessment';
import {
  GatewayRejectedError,
  GatewayUnavailableError,
  gatewayByCode,
  PAYMENT_GATEWAY,
  type PaymentGatewayResolver,
} from '../domain/payment-gateway';
import {
  PAYMENT_OUTCOME_REPOSITORY,
  type PaymentDecisionOutcome,
  type PaymentOutcomeRepository,
} from '../domain/payment-outcome.repository';
import type { PaymentRecord } from '../domain/payment.repository';

/** The gateway could not tell us the status; the caller must try again later. */
export class PaymentVerificationUnavailable extends Error {
  constructor() {
    super('Payment status could not be verified with the gateway');
    this.name = 'PaymentVerificationUnavailable';
  }
}

export interface PaymentVerificationRequest {
  payment: PaymentRecord;
  /** Present when a callback triggered the check; its claims must agree with the gateway. */
  callback: CallbackClaim | null;
  paymentMethod: string | null;
  requestId?: string;
}

/**
 * Verify-by-fetch (ARCHITECTURE.md §6.2 step 4): asks the gateway for the authoritative status
 * and applies the assessed decision atomically. Shared by the callback handler and by later
 * reconciliation jobs, so both follow exactly the same rules.
 */
@Injectable()
export class VerifyPaymentService {
  private readonly logger = new Logger(VerifyPaymentService.name);

  constructor(
    @Inject(PAYMENT_OUTCOME_REPOSITORY) private readonly outcomes: PaymentOutcomeRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGatewayResolver | null,
  ) {}

  async verify(
    request: PaymentVerificationRequest,
    now = new Date(),
  ): Promise<PaymentDecisionOutcome> {
    const { payment } = request;
    const gateway = gatewayByCode(this.gateway, payment.gateway);
    if (!gateway) {
      throw new PaymentVerificationUnavailable();
    }
    let observed;
    try {
      if (payment.gateway === 'TELEGRAM_STARS' && request.callback) {
        // A successful_payment update, received through the secret-validated Bot API webhook,
        // is Telegram's authoritative payment event. Telegram exposes no status lookup by payload.
        observed = {
          merchantOrderId: payment.merchantOrderId,
          gatewayReference: request.callback.gatewayReference,
          amount: request.callback.amount,
          currency: payment.currency,
          outcome: 'PAID' as const,
          rawStatus: 'TELEGRAM_SUCCESSFUL_PAYMENT',
        };
      } else {
        observed = await gateway.getTransactionStatus(payment.merchantOrderId);
      }
    } catch (error) {
      if (error instanceof GatewayUnavailableError || error instanceof GatewayRejectedError) {
        throw new PaymentVerificationUnavailable();
      }
      throw error;
    }

    const decision = assessGatewayStatus(payment, observed, request.callback, now);
    const outcome = await this.outcomes.applyDecision({
      payment,
      decision,
      trigger: request.callback ? 'CALLBACK' : 'RECONCILIATION',
      paymentMethod: request.paymentMethod,
      requestId: request.requestId,
      now,
    });

    const log = {
      requestId: request.requestId,
      orderId: payment.orderId,
      paymentId: payment.id,
      providerReference: observed.gatewayReference || undefined,
      outcome,
    };
    if (
      decision.kind === 'RECONCILE' ||
      outcome === 'PAID_FOR_CLOSED_ORDER' ||
      outcome === 'DUPLICATE_PAYMENT'
    ) {
      this.logger.warn({ event: 'payment.reconciliation_required', ...log });
    } else if (outcome === 'CONFIRMED') {
      this.logger.log({ event: 'payment.confirmed', ...log });
    } else {
      this.logger.log({ event: 'payment.verified', ...log });
    }
    return outcome;
  }
}
