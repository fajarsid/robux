# Phase 14 — Telegram Account Sales Bot Design

**Status:** Target design / not an implementation claim  
**Business priority:** Sell only Telegram Accounts already available in Core inventory.

## Authority boundaries

The bot is a customer channel. The Core remains the authority for product availability, active price, order creation, payment state, reservation, fulfillment, order status, and account handoff. The bot must use Core APIs and must not access PostgreSQL or create shadow orders, payment records, inventory, fulfillment state, retry jobs, or routing decisions.

```text
Telegram update → bot channel → Core catalog/order/payment APIs
                                  ↓
                           verified payment
                                  ↓
                        existing outbox/worker
                                  ↓
                    inventory reservation + sale
                                  ↓
                   existing protected handoff
```

## Reuse from the current system

- `GET /api/v1/products` returns active products with current versioned price and availability. The bot should show only the `TELEGRAM_ACCOUNT` line and `AVAILABLE` offers.
- `POST /api/v1/orders` derives price, product line and fulfillment type on the server. Guest checkout currently requires a contact email; the bot must collect it or use an authenticated customer link rather than inventing an identity email.
- `POST /api/v1/track/{trackingToken}/payment` and `GET` use the opaque guest tracking token. Duitku initiation and callback verification remain in Core.
- `GET /api/v1/track/{trackingToken}` exposes customer-safe status only.
- `POST /api/v1/track/handoff` accepts the tracking token in the request body and returns account data only for a fulfilled Telegram Account order. The existing service hashes the token for lookup, checks fulfillment/product line, moves stock to delivered, and audits without writing payload data to audit fields.
- The existing inventory transaction uses row locks and `SKIP LOCKED`; bot code must never choose an inventory item. Payment expiry/cancellation and fulfillment failure must go through current Core lifecycle/release code.

## Bot interaction outline

1. `/start` welcomes the user and requests the Core Telegram Account catalog.
2. The account catalog displays only customer-safe name, active price, and current availability. No source, stock item identifier, or internal routing detail is sent.
3. Product selection is revalidated against current Core catalog data. Price and `priceVersionId` are passed to Core only as the customer's observed offer; Core revalidates them and computes the total.
4. The bot gathers the guest contact email required by the current Core contract, or uses a separately authenticated customer link. It creates the order with a high-entropy idempotency key and stores the returned tracking token only as protected order-access data associated with the stable Telegram numeric user ID.
5. Payment methods, payment URL/instructions, expiry, and status come from Core. Telegram callbacks, screenshots, and browser redirects never mark an order paid.
6. The bot polls/reads Core order status or consumes an idempotent Core notification event. It reports payment/fulfillment status only from Core.
7. Once Core reports `FULFILLED`, the bot offers a protected handoff action. Any handoff call revalidates the Telegram-user-to-order association. Credentials must not appear in callback data, URLs, analytics, logs, or normal order history. Prefer the existing protected web handoff surface; if an implementation returns payload to the bot, the bot must avoid message persistence, logging and accidental forwarding and needs a reviewed threat model before launch.

## Identity and order association

Use Telegram's immutable numeric `from.id` as the external identity key; a username is optional and mutable. Do not accept a customer ID or tracking token from callback data. The Core guest tracking token is a bearer capability. If a durable “My Orders” mapping is added, store only the minimum mapping needed and protect the token at rest with a configured application key; do not duplicate order state. An untrusted bot webhook body cannot establish a Core customer identity without successful webhook secret validation.

## Inventory and concurrency

The bot never reserves stock at browsing time, selects an inventory ID, or marks stock sold. The Core remains responsible for stock availability and reservation after payment confirmation. Concurrent orders must rely on existing Postgres transactions and row locks. A paid order that cannot obtain stock remains unpaid? No: payment is already authoritative; it must enter the existing pending/reconciliation handling and must never receive credentials or be marked fulfilled. Expired/cancelled unpaid orders must release any applicable reservation through the established lifecycle.

## Payment and production gate

The repository's existing Duitku payment flow is technically reusable from Core. However, [ADR-011](ADR/ADR-011-telegram-bot-commerce-payment-boundary.md) records Telegram's requirement that digital goods sold inside a bot use Telegram Stars. A Telegram Account is digital; no approved exception or alternative authorization is present in the repository. Consequently, a Duitku bot checkout can be used for controlled development/test verification only, not enabled for production based only on code completion. Resolve the payment model and obtain platform, lawful-source, commercial, and payment-provider approval before enabling live account sales. If Stars is required, implement its verified payment lifecycle inside Core; do not add a bot-side payment shortcut.

## Inventory administration

The existing admin API encrypts submitted payloads before persistence and never returns ciphertext in list projections. Current actions are list/create/block. Phase 14 must not add plaintext reveal to the normal table. Any release or reveal operation must be audited, permission-gated, and transactional, with a defined reason and linkage checks; arbitrary status mutation is not an acceptable recovery path. Aggregate available/reserved/sold/delivered/blocked counts should derive from existing inventory/source records, not a second stock counter.

## Limits

- No account sourcing, creation, login, OTP/session handling, or supplier automation.
- No claim that imported stock is authorized for resale, transferable, valid, or recoverable.
- No Premium/Stars recipient fulfillment in the account checkout path.
- No production enablement of Duitku-based purchases inside the bot without documented authorization.
- No credential reveal until Core has confirmed payment and fulfillment and the order-to-Telegram identity association is authorized.
