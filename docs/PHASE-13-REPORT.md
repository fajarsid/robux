# Phase 13 Result — Telegram bot and real fulfillment provider integration

**Status: PASS WITH NOTES — research and capability gate complete; bot and real-provider implementation deferred**  
**Date:** 2026-10-08

## Provider research

| Product/channel | Result |
|---|---|
| Telegram Premium | **GO WITH LIMITATIONS.** Official Bot API `giftPremiumSubscription` supports 3, 6, and 12 months using the bot's Stars balance. It requires a numeric Telegram user ID. Phase 12's one-month Premium variant is unsupported by this method. The API capability does not establish reseller/commercial authorization. |
| Telegram Stars recipient top-up | **NO-GO.** No official Bot API recipient balance top-up was found. A bot invoice collects Stars for the bot's own digital goods and does not credit a customer's balance. |
| Telegram Accounts | **RESEARCH REQUIRED / NO-GO FOR AUTOMATION.** No authorized provisioning API or legitimate inventory supplier was verified; account resale permission remains unresolved. |
| Digital sales inside Telegram bot | **Payment gate.** Telegram Bot Developer Terms require Telegram Stars for digital goods/services sold inside bots and mini apps. Existing Duitku cannot be reused for that in-bot digital checkout. |

Detailed sources, authentication, request/response behavior, verification, idempotency, rate limits, failure and refund caveats, and per-product decisions are in [Phase 13 Provider Research](PHASE-13-PROVIDER-RESEARCH.md).

## Bot and Core integration

No bot service, webhook route, framework dependency, Telegram identity mapping, or Core payment adapter was added. Repository inspection found no existing bot framework/service. The existing Core remains the single authority for product/pricing, order/payment state, inventory, fulfillment, and handoff. Any future bot must call those existing APIs and receive updates through Nginx; it must not maintain a second catalog/order/inventory system or mark payment paid based on client input.

Bot implementation is deferred because current digital product purchase through Telegram requires a Stars payment design, while the Core currently uses Duitku; Stars recipient balance top-up has no verified official API; and Premium's official gift method has no documented provider idempotency key and needs commercial authorization. These are real product and payment boundaries, not missing adapter code to work around.

## Fulfillment and account safety

No real Telegram provider was configured or invoked. The Phase 12 mock remains **MOCK / NOT PRODUCTION SUPPLIER**. Premium timeouts must be treated as unknown and reconciled, not blindly retried. Telegram Account inventory, reservation, and protected handoff from Phase 12 remain unchanged; no account credentials or handoff data are exposed through a bot.

## Baseline and validation

| Check | Result |
|---|---|
| API unit tests | **362/362 passed** (39 suites) |
| Web tests | **149/149 passed** (28 files) |
| PostgreSQL integration | **259/259 passed** (27 suites, Testcontainers) |
| Combined unit/web command | Exit code 0 |
| Integration command | Exit code 0; Jest emitted its known “did not exit one second” open-handle warning after all tests passed |
| Typecheck, lint, Docker Compose config/build | Not rerun; no application, dependency, or container changes were made. Phase 12 report records these as passing. |

This Phase 13 change is documentation only. No new tests were added because no bot/provider behavior was implemented. The open-handle warning remains an existing test-process limitation and is not hidden with `--forceExit`.

## Files changed

- `docs/PHASE-13-PROVIDER-RESEARCH.md` — capability audit and decisions with official source links.
- `docs/PHASE-13-REPORT.md` — this report.
- `docs/ARCHITECTURE.md` — Phase 13 policy/capability gate and future bot boundary.
- `docs/ADR/ADR-011-telegram-bot-commerce-payment-boundary.md` — accepted payment and Core-authority boundary.

## Known risks and limitations

- Commercial Premium resale/reward eligibility has not been established by the reviewed Telegram documentation; obtain written authorization/legal review before launch.
- Premium fulfillment requires numeric Telegram user IDs, unlike the current username recipient input, and gift calls lack a documented idempotency key.
- A Premium gift may not be reclaimable if the customer payment is refunded or disputed.
- Stars recipient top-up and compliant Telegram Account sourcing remain unavailable/unverified.
- The full integration suite still reports an open async handle after all assertions pass, though the command exits successfully.

## Not implemented

No Telegram bot, Telegram webhook, Telegram Stars payment adapter, real Premium provider, recipient Stars top-up, Telegram Account supplier, account automation, provider credentials, or deployment changes were added. No real transaction was attempted.

**Next recommended phase:** Resolve the digital-goods payment model and obtain written commercial authorization for Premium gifts; re-scope Stars from recipient balance top-up if no authorized provider exists; verify a lawful account supplier before implementing a bot checkout. Then implement a Core-connected bot and only the provider paths that pass those gates.
