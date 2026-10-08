# Phase 16 — Multi-payment and TON Treasury

## Scope and boundaries

The existing order, payment, inventory, fulfillment, queue, webhook, and handoff systems remain authoritative. `PaymentGateway` is now resolved through a registry by customer-facing method and persisted provider code, allowing Duitku and Telegram Stars to coexist. A payment's settlement currency and amount are snapshotted on the payment attempt; product/order values remain IDR. Product price versions can carry an optional explicit integer `starsAmount`. It is never converted from IDR.

`TELEGRAM_STARS` creates an official Bot API invoice in XTR and does not provide a provider token. A payment remains pending until the secret-token-protected Telegram webhook delivers a valid `successful_payment` update. The update must match the stored merchant reference, XTR amount, product quote, pending order and owning Telegram numeric user ID. Telegram charge IDs become the payment reference only after payment succeeds. Duplicate updates use the existing webhook event idempotency and payment row locking. A Telegram API timeout during invoice creation leaves the payment attempt pending; retries reuse it instead of risking a second invoice. Telegram does not provide a status-by-order query through this Bot API flow, so ambiguous payments require callback delivery or reconciliation.

Duitku remains unchanged as the IDR provider and its existing callback verification remains in place. For QRIS methods, the adapter now retains a bounded `qrString` as an owner-scoped payment instruction; non-QR methods discard it. No provider credential or QR payload is logged. The existing Duitku payment URL remains available as its current presentation route.

## TON treasury

The treasury module is deliberately separate from customer payment and order services. It uses integer nanoTON policy values, checks a minimum balance, computes a refill toward a target, applies a maximum refill and daily limit, and requires the destination to match the configured allowlist. A PostgreSQL advisory transaction lock plus a UTC-day idempotency key prevents duplicate scheduler requests. A resulting database record is a **refill plan only** (`provider=BINANCE_DISABLED`); it does not submit a Binance withdrawal or send TON.

There is no TON chain balance reader, wallet signer, Binance adapter, supplier payment adapter, Fragment integration, or automated reconciliation worker in this change. `BINANCE_WITHDRAWAL_ENABLED=true` fails startup because the live adapter is not implemented. No private key or Binance credential is configured or stored. Do not interpret a `REQUESTED` treasury row as funds submitted or confirmed.

## Configuration

Defaults are fail-closed:

```dotenv
PAYMENT_PROVIDER_STARS_ENABLED=false
TELEGRAM_STARS_PRODUCTION_AUTHORIZED=false
TON_TREASURY_ENABLED=false
TON_TREASURY_PRODUCTION_AUTHORIZED=false
BINANCE_WITHDRAWAL_ENABLED=false
TON_TREASURY_MIN_BALANCE_NANO=20000000000
TON_TREASURY_TARGET_BALANCE_NANO=100000000000
TON_TREASURY_MAX_REFILL_NANO=100000000000
TON_TREASURY_DAILY_LIMIT_NANO=100000000000
TON_TREASURY_ALLOWED_ADDRESSES=
```

Stars requires a Telegram bot token and a product price version with an explicit XTR quote. Production Stars requires a separate authorization flag, which is only a configuration gate, not evidence of commercial approval. Treasury production mode likewise requires explicit authorization. Live Binance withdrawals remain impossible regardless of those flags.

## Product/payment method capability

The Core offers the Stars method only when the provider is enabled and configured. Checkout additionally requires the order's immutable price snapshot to contain a Stars quote. This keeps the conversion policy explicit per price version and prevents the browser from choosing the XTR amount. Duitku method configuration remains merchant-controlled and does not depend on Stars.

## Operational and production gates

- Telegram Stars and XTR invoice behavior needs Telegram test-environment/manual validation before production use.
- Telegram commercial policy approval is not established by this implementation.
- Duitku remains the existing customer payment provider; its production credentials and merchant setup remain deployment-specific.
- TON treasury monitoring and refill execution are not production implemented. All supplier payments remain unavailable; there is no Binance integration or wallet signing.
- Run the additive Prisma migration in a disposable PostgreSQL 17 environment before deployment. The migration preserves existing IDR payment rows and adds nullable XTR/Stars and treasury fields.

## Reference

- [Telegram Bot Payments for Digital Goods and Services](https://core.telegram.org/bots/payments-stars) — XTR invoice and successful-payment update contract.
- [Telegram Bot API](https://core.telegram.org/bots/api) — Bot API request and webhook update contract.
- Existing Duitku adapter contract: [Duitku integration notes](integrations/duitku.md).
