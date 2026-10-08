# Phase 17 — Telegram Account Bot and Mini App MVP

## Architecture used

The bot remains a module of the existing Core API. Telegram updates enter through the existing secret-token-protected webhook; the bot handles `/start`, `/orders`, and `/help`, persists the stable Telegram numeric identity, and opens the existing `/telegram-store` Mini App. This avoids a second backend service, database, order model, or queue.

The Mini App authenticates requests with Telegram Web App `initData`. The Core verifies the Bot API HMAC and authentication age before resolving the Telegram identity. Product catalog, active price, stock, payment methods, order ownership, payment state, fulfillment and account handoff are read or changed through existing Core services. Order creation and payment creation use stable browser-generated idempotency keys across retries.

The Core's existing order-payment-outbox-worker path is unchanged. Mock payment is available only in non-production mock configuration. Duitku and Stars remain separate registered payment methods; production method visibility and authorization gates remain controlled by Core configuration. The bot does not verify payment itself.

## Customer journey

1. `/start` opens the Telegram Account Store Mini App.
2. The Mini App loads only Telegram Account products from the Core catalog and shows Core pricing and availability.
3. Checkout creates a Core order and starts one enabled payment method.
4. The Mini App polls the owner-scoped order and payment views. It never sets payment state.
5. A verified payment callback/update triggers the existing outbox, queue, worker and inventory fulfillment path.
6. After Core reports fulfillment complete, handoff remains owner-authorized and available only through the existing secure handoff service.
7. The notification worker sends payment/completion messages with an order-scoped Mini App deep link. The deep link carries only a non-secret order reference; Core checks the authenticated Telegram owner on every request.

## Payment presentation and limitations

The Mini App renders payment status and expiry, offers the provider payment URL where available, and exposes an owner-scoped QRIS payload as copyable payment data. No QR encoder dependency or provider-specific QR format was introduced. Therefore this implementation does not render a QR image itself; when only a raw QRIS payload is available, users may need the provider instructions or a separate display to scan it. Duitku's existing payment URL remains the fallback where configured.

Mock payment controls are explicitly labelled as local simulation and unavailable in production. Stars is shown only when Core enables it and the product price version has an explicit XTR quote. No production payment authorization is asserted by this MVP.

## Security boundaries

- The client-supplied Telegram user ID is ignored; signed Telegram `initData` is the identity proof.
- Orders, payments and handoff are scoped to the mapped Telegram numeric user ID.
- Catalog/order/payment views do not expose inventory identifiers, provider references, source details, or encrypted account payloads.
- Credentials are returned only from the existing authenticated, fulfilled-order handoff endpoint and are not included in bot notifications or URLs.
- Telegram webhook secret validation, update de-duplication, request rate limits, no-store responses and existing payment callback verification remain active.
- Bot and Core code never handles Binance, TON signing, supplier automation, or account sourcing.

## Validation

The automated `telegram-miniapp.int-spec.ts` exercises catalog → idempotent order → mock payment confirmation → worker fulfillment → SOLD/DELIVERED inventory → secure handoff, including ownership checks. Phase 17 adds coverage for bot notification deep links and Mini App order deep-link navigation/payment retry idempotency. Final regression totals and remaining operational limitations are recorded in `PHASE-17-REPORT.md`.
