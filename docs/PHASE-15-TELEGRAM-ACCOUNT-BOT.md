# Phase 15 implementation — Telegram Account Mini App

## Runtime flow

`/start` and `/orders` arrive at `POST /api/v1/telegram/webhook`. The API checks Telegram's webhook secret, stores the update ID for replay deduplication, and replies with a Telegram Web App button. The button opens the existing Next.js application at `/telegram-store`.

The Mini App loads Telegram's official Web App bridge and sends the raw `initData` as `Authorization: tma <initData>`. The API validates the HMAC using the configured bot token, rejects stale/future timestamps and duplicate query keys, then maps the verified numeric Telegram user ID to a Core-owned order link. A username is only a mutable profile snapshot.

The Mini App reads only Telegram Account products from the Core catalog. It asks for the existing required guest contact email, creates a Core order with a scoped idempotency key, and starts payment using the active Core gateway method. The client never sends an amount, inventory identifier, fulfillment type or payment state. My Orders, detail, mock payment settlement and handoff all require valid signed Telegram initData and check the `telegram_orders` owner mapping.

The account payload remains encrypted by the Phase 12 inventory cipher. The normal catalog/order response excludes it. Handoff uses `DigitalAccountHandoffService.forTelegram`, which rechecks order ownership and `FULFILLED`, audits delivery, decrypts on the server and returns `no-store` data. The Mini App holds the response in component memory only.

## Development payment

Set `PAYMENT_GATEWAY=mock` in a non-production environment (the development Compose override does this). Method `MK` creates a pending attempt. The development-only Mini App control asks the API to simulate `PAID`, `FAILED` or `EXPIRED`; the adapter signs a local callback, and the existing callback handler authenticates it, fetches authoritative mock status and applies normal Core validation and idempotent state transitions. The mock payment map is process-local and is reset on API restart. **It is not a payment rail and must never be enabled in production.** Production config rejects `PAYMENT_GATEWAY=mock`.

For production Bot API configuration, set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` (16–256 characters), and `TELEGRAM_MINI_APP_URL` to the HTTPS Mini App URL. Keep values in the deployment secret manager; do not commit them. Register Telegram's webhook to `https://<public-host>/api/v1/telegram/webhook` with the same secret token. Nginx already routes `/api/` to the API; the API container has no published port. `/start` and `/help` are supported, and `/orders` opens the owner-scoped Mini App order list.

## Notifications

Order-created confirmation is sent by the API. `PAYMENT_CONFIRMED` and `FULFILLMENT_COMPLETED` Core outbox events are routed to a Telegram notification job on the existing `fulfillment` queue. Notification claims are persisted per Telegram order to prevent routine duplicate delivery. Bot delivery is best effort; Telegram's sendMessage call does not provide an exactly-once guarantee. The Mini App also polls Core order state while an order is open.

## Operational/security boundaries

- No bot token means the bot/webhook/Mini App authentication is unavailable; it does not make catalog or mock routes anonymous.
- Mock payment and mock fulfillment are development/test capabilities. No mock response means a real payment or a real external account transfer.
- The fulfillment worker consumes existing inventory items and uses the existing transaction/lease/idempotency flow.
- Telegram Account inventory is not sourced or created by this code. No account login, session automation, OTP interception, scraping or anti-abuse bypass is implemented.
- Production payment method and commercial/account-transfer authorization remain gated by the decisions in `PHASE-15-PAYMENT-FEASIBILITY.md` and ADR-011. The local mock MVP does not satisfy those gates.
- Do not expose credentials in Bot chat text, callback data, URLs, analytics or logs. The Bot only sends a button leading to the protected handoff UI.
