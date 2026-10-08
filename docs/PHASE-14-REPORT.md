# Phase 14 Result — Telegram Account Sales Bot Commerce MVP

**Status: BLOCKED / NOT IMPLEMENTED**  
**Date:** 2026-10-08

## Business goal

Telegram Account sales through a Telegram Bot storefront, using already-stocked account inventory and the existing Digital Fulfillment Core.

## Gap analysis

See [Phase 14 Gap Analysis](PHASE-14-GAP-ANALYSIS.md). It was added before application-code changes and records the required priority correction:

> **PREVIOUS ASSUMPTION DOES NOT MATCH CURRENT BUSINESS PRIORITY**

Phase 13's Premium/Stars-first bot assumption is superseded for this phase. This report preserves the historical ADRs while refocusing the architecture on Telegram Account inventory.

## Implemented in this continuation

- Added the required account-first audit and gap analysis.
- Added the Telegram Account storefront and handoff target design.
- Updated architecture guidance to identify the account-first business priority and distinguish technical Duitku reuse from production authorization.

## Reused / audited

- Product, ProductVersion, and active versioned pricing; public catalog availability.
- Core order creation with server-side price/type resolution, immutable snapshots, idempotency, guest tracking tokens, and contact email requirement.
- Duitku payment creation, callback validation, fetched-status verification, amount matching, and payment/order transitions inside Core.
- Outbox/BullMQ fulfillment flow; account inventory reservation/release/sale through existing database transactions and locks.
- Encrypted account payload, RBAC inventory API, customer-safe projections, and authenticated/guest protected handoff.

## Not implemented

- Telegram bot/webhook/service, identity/order mapping, bot catalog/checkout UI, payment/order tracking, or notifications.
- Inventory aggregate/status APIs, release endpoint, or admin UI updates.
- Bot-linked end-to-end/concurrency/security tests.
- No product/payment/provider/inventory/schema changes were made.

## Production blockers

1. **Payment policy:** Existing [ADR-011](ADR/ADR-011-telegram-bot-commerce-payment-boundary.md) documents that digital goods sold inside a Telegram bot must use Telegram Stars. A Telegram Account is digital, while the requested in-bot flow specifies Duitku. Existing Core Duitku support is technical capability, not permission to use it for this flow. Production enablement remains blocked pending a compliant, documented payment model and required authorization. See [Telegram Bot Developer Terms](https://telegram.org/tos/bot-developers) and [Telegram Stars payments](https://core.telegram.org/bots/payments-stars).
2. **Business/source authorization:** The repository has no evidence of authorized Telegram Account sourcing, resale rights, or a supported transfer mechanism. The technical MVP may only manage stock the operator has independently and lawfully obtained. No automated sourcing or account creation is implemented.
3. **Secure bot identity/handoff:** Existing guest tracking tokens can authorize handoff, but a durable, ownership-checked Telegram identity-to-order association and bot notification path are not present.

## Baseline

Before edits: API **362/362**, web **149/149**, PostgreSQL integration **259/259**, typecheck and lint **PASS**, Docker Compose config and image build **PASS**. The integration suite passed all 259 tests and exited successfully. The baseline previously emitted Jest's known one-second open-handle warning; this turn's `--detectOpenHandles` rerun passed **259/259** and completed without a remaining-handle stack in the final output. No application tests were rerun because no application code changed.

## Files changed

- `docs/PHASE-14-GAP-ANALYSIS.md`
- `docs/PHASE-14-TELEGRAM-ACCOUNT-BOT.md`
- `docs/PHASE-14-REPORT.md`
- `docs/ARCHITECTURE.md`

## Next recommended phase

Resolve a Telegram-compliant payment model for account sales and verify the lawful sourcing/resale/handoff model. Then implement a test-mode account bot using only Core APIs, encrypted/minimal Telegram identity linkage, existing payment/fulfillment/handoff, and end-to-end race/security tests. Keep live sales disabled until authorization is documented.
