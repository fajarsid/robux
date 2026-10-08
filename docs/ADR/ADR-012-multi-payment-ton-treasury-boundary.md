# ADR-012: Multiple customer payment providers and separate supplier treasury

**Status:** Accepted for implementation; production enablement gated  
**Date:** 2026-10-08

## Context

The platform needs more than one customer payment method while retaining its existing Duitku contract. Telegram Stars settles digital-goods invoices in XTR, while catalog and order prices remain IDR. Separately, some future fulfillment suppliers may require TON funding. Binance/TON movement is treasury activity and must not become an order payment dependency.

## Decision

- Resolve customer payment methods to provider adapters through one registry. Keep Duitku as an adapter and add a distinct Telegram Stars adapter.
- Persist each payment attempt's provider, method, amount and settlement currency. Keep IDR order pricing authoritative and capture an optional explicit Stars amount in the immutable price/order snapshot; never infer XTR from IDR.
- Only authenticated Telegram `successful_payment` updates can confirm a Stars payment. Pre-checkout is validated against the pending payment/order, XTR amount, expiry and numeric owner identity. Duplicate updates reuse the existing webhook and payment idempotency path.
- Keep treasury services outside OrderService, PaymentService and customer-facing Telegram code. Treasury plans use integer nanoTON, thresholds, destination allowlisting, maximum refill and daily limits, a database lock and idempotency key.
- Do not enable live Binance withdrawals, TON signing, supplier payment or Fragment automation until a separately reviewed, authorized provider adapter and operational safeguards exist.
- Production flags fail closed by default; mock payment is not a production fallback.

## Consequences

Duitku and Stars can share the same Core order/payment lifecycle without teaching fulfillment which provider collected payment. Stars amounts require deliberate product-price configuration. The treasury schema and planning service support policy/testing but do not move funds; there is no live balance source or external treasury provider yet. Production flags do not grant legal or commercial authorization.

## Sources

- [Telegram Bot Payments for Digital Goods and Services](https://core.telegram.org/bots/payments-stars)
- [Telegram Bot API](https://core.telegram.org/bots/api)
