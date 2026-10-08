# Phase 14 Gap Analysis — Telegram Account Sales Bot

**Business objective:** sell Telegram Accounts already present in the platform's inventory through a Telegram Bot storefront. The Digital Fulfillment Core remains authoritative for catalog, pricing, orders, payments, inventory, fulfillment, and handoff.

**Audit date:** 2026-10-08. This document was created before application-code changes for the account-sales scope.

## 1. Business goal already established

The current Phase 14 objective is the customer-facing sale of stocked Telegram Accounts. The customer should browse availability, create a Core order, pay through an allowed and verified payment path, receive inventory-backed fulfillment, and obtain the existing protected account handoff. Premium and Stars remain domain capabilities but are not this phase's storefront focus.

The repository's original `docs/PRD.md` is the general Robux fulfillment PRD. There is no separate “Telegram Digital Product Auto-Delivery Bot” PRD in the repository. Phase 12 and ADR-010 establish the Telegram Account inventory and handoff substrate; Phase 13 and ADR-011 establish a Telegram bot payment boundary.

## 2. Does Phase 12 match this goal?

Partly. Phase 12 created Telegram product definitions, encrypted account inventory, transactional item reservation/consumption, admin create/list/block operations, a guest/customer handoff service, product-derived checkout configuration, and integration tests. It did not create a Telegram bot, storefront catalog flow, Telegram identity/order association, bot order history, payment/order status notifications, or an end-to-end bot checkout. Its mock provider is not a real Telegram supplier, but account fulfillment is inventory-backed and does not require one.

The seed starts account stock empty. Account stock must be added by the existing RBAC-controlled admin API; the customer-facing catalog must not report purchasable stock unless the Core's existing availability logic permits checkout.

## 3. Did Phase 13 over-focus on Premium/Stars?

Yes, relative to the current business priority. Phase 13 investigated Premium gifting, recipient ID resolution, and Stars payment, then deferred bot implementation around those concerns. That was consistent with its then-stated objective, but it is not the account-first storefront requested now. This is a scope correction, not a reason to erase historical Phase 13 decisions.

## 4. Explicit priority correction

**PREVIOUS ASSUMPTION DOES NOT MATCH CURRENT BUSINESS PRIORITY**

- **Previous assumption:** the first bot storefront should sell Premium, requiring recipient resolution and a Telegram Stars payment model; Account sales should wait for authorized sourcing.
- **Current requirement:** sell already-stocked Telegram Accounts using Phase 12 inventory and handoff. No account creation or sourcing automation is requested.
- **Architecture impact:** the flow is `DIGITAL_DELIVERY`, has no recipient input, reserves an existing inventory item through the Core fulfillment engine, and uses the existing protected guest/customer handoff. Premium recipient/provider work is outside the critical path.
- **Required correction:** build the bot as a channel to existing product/order/payment/handoff APIs; do not add a parallel order, inventory, or payment authority. Preserve the Phase 13 history and ADR-011 payment boundary.

## 5. Reusable Phase 12/Core components

- Product, ProductVersion, and price-version catalog; backend-authoritative offer validation and order price snapshots.
- `TELEGRAM_ACCOUNT` product line and `DIGITAL_DELIVERY` fulfillment mapping; account checkout requires no Telegram recipient.
- `DigitalInventoryItem` payload encrypted with the isolated API encryption key; ciphertext is omitted from normal inventory and order projections.
- Fulfillment source ledger, deterministic routing, transactional reservation with row locks/`SKIP LOCKED`, sale/release lifecycle, outbox, BullMQ, worker, retry, idempotency, and reconciliation.
- Existing order creation and guest tracking/payment APIs; verified Duitku callback handling remains entirely in the Core.
- `DigitalAccountHandoffService`: only fulfilled account orders can be revealed; guest requests present the existing tracking token in a rate-limited POST body; handoff is no-store/audited.
- Admin account inventory create/list/block and RBAC; shared admin UI conventions.

## 6. Storefront gaps

- No Telegram bot framework, bot module/service, webhook endpoint, webhook secret validation, bot token configuration, or Nginx webhook route.
- No stable Telegram user identity mapping or safe mapping from a Telegram user to their bot-originated orders. The Core's existing guest model can avoid requiring a new password/account system, but “My Orders” needs a minimal secure association.
- No Core bot-facing catalog/availability projection or bot checkout adapter. Existing public catalog and guest order/payment/tracking APIs are candidates for reuse; no database access from a bot should be added.
- No bot conversational flow, duplicate callback/update handling, per-user rate limits, order list/status UI, or status notification consumer.
- No notification module/worker is implemented. `outbox-route-table.ts` routes payment-confirmed and fulfillment-requested events, not customer notifications.
- Inventory admin list is capped at 500, reports items individually, and omits payload; account admin API currently supports list/create/block but not release or aggregate status counts. Current inventory lifecycle performs reservation/release/sale in fulfillment code. Any admin release must be narrowly defined and transactional rather than an arbitrary status edit.
- There is no real inventory supplier or account verification/transfer integration. The existing handoff returns decrypted account fields to an authorized Core caller; a bot must not put them into logs/callbacks or expose them before paid + fulfilled + owner checks.

## 7. Payment/platform conflict

The user's requested bot checkout names Duitku, but existing [ADR-011](ADR/ADR-011-telegram-bot-commerce-payment-boundary.md) records Telegram's rule that digital goods sold inside bots/mini apps must use Telegram Stars, and prohibits in-bot Duitku. A Telegram Account is a digital account/product, so the repository contains no basis to exempt it from that rule. Technical reuse of Duitku is possible through the Core guest payment endpoint; policy compliance is not established by that technical capability.

Therefore the audit distinguishes:

- **Technical MVP:** can exercise the existing Core order, Duitku sandbox/test payment, verified callback, inventory fulfillment, and protected handoff path without implementing payment verification in the bot.
- **Production enablement:** blocked until the business establishes an allowed sales/payment model for this Telegram storefront and obtains the necessary platform, supplier, and payment-provider authorization. Do not silently treat the existing Duitku integration as approval to take live in-bot payments. If the compliant model requires Telegram Stars, the Core needs an intentional Stars payment lifecycle rather than a bot-side workaround.

## 8. Preserve

- Single Core authority and existing Phase 10–12 order/payment/fulfillment/inventory state machines.
- Existing deterministic inventory source routing, reservation and release guarantees, encryption, audit, RBAC, guest tracking token, and handoff authorization.
- Duitku webhook verification and payment idempotency inside Core; bot callbacks or screenshots never mark payments paid.
- Historical Premium/Stars product definitions and Phase 13 research, while keeping both out of the main account sales flow.
- Nginx as the only public edge, private Postgres/Redis, non-root/read-only container controls, and current no-secret logging.

## 9. Correct or extend

- Add an isolated bot customer interface and webhook security using the repository's Node.js/TypeScript conventions.
- Make bot-originated catalog, checkout, order lookup, payment initiation/status, and handoff call Core APIs only.
- Bind orders to stable Telegram numeric user IDs through a minimal identity/order-link mechanism, or use the existing guest tracking token with protected storage; never use usernames as identity.
- Add completion/status notifications through an existing Core event path or a small idempotent adapter. Do not add another fulfillment queue or order database.
- Ensure failed/expired payment releases stock according to the existing lifecycle, and test concurrent reservations across bot orders.
- Add admin inventory aggregate counts and supported release/inspection only if existing endpoints do not already provide them; retain no-secret projections and append-only audit.
- Gate production checkout on a documented compliant payment/commercial model; development integration tests may exercise the existing Core payment flow without asserting commercial authorization.

## 10. Not needed in this phase

- Premium gift provider, recipient username-to-ID resolution, Stars recipient balance top-up, or Premium/Stars storefront focus.
- Telegram account creation, sourcing, login automation, session/OTP handling, or any authentication bypass.
- A second customer/order/payment/inventory database, direct bot-to-Postgres access, a new payment gateway, or a new fulfillment/queue engine.
- Credential reveal in ordinary chat messages, callbacks, URLs/query strings, logs, analytics, or customer order history.

## 11. Compliance and technical blockers

- **Production payment/platform authorization:** unresolved. ADR-011 says Telegram in-bot digital goods require Stars. This conflicts with the requested Duitku rail. A technical sandbox flow is not production authorization.
- **Account business model/source:** repository has no verified lawful supplier/source evidence or account transfer guarantee. This phase may manage only inventory the operator has lawfully obtained; it must not automate acquisition. Production resale terms/authorization require independent verification.
- **Fulfillment quality:** inventory handoff can securely deliver the stored payload but does not verify that an account remains valid, transferable, or recoverable after sale.
- **Open-handle diagnostic:** baseline API, web, and PostgreSQL suites all pass. Jest's previous full integration run emitted the known one-second warning. The diagnostic rerun with `--detectOpenHandles` completed 259/259 with no remaining-handle stack in its final output; retain the warning history and revalidate after implementation.

## Audit baseline

Before application changes: API **362/362**, web **149/149**, PostgreSQL integration **259/259**, typecheck **PASS**, lint **PASS**, Docker Compose config **PASS**, Docker image build **PASS**. No application code had been changed when this analysis was written.
