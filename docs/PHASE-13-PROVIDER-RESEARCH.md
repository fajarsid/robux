# Phase 13 — Telegram provider capability research

**Research date:** 2026-10-08  
**Scope:** Official Telegram capabilities and the Phase 12 product model. No supplier integration or bot was implemented as part of this research.

## Executive decision

| Product | Decision | Reason |
|---|---|---|
| Telegram Premium | **GO WITH LIMITATIONS** | Official Bot API offers `giftPremiumSubscription` for 3/6/12 months, from the bot's Stars balance. It accepts a numeric Telegram user ID, has no documented idempotency key, and does not establish a third-party reseller agreement. The Phase 12 1-month variant is unsupported by this method. |
| Telegram Stars recipient top-up | **NO-GO** | No official Bot API method was found to transfer or credit Stars to another user's personal balance. Bot Stars payments credit the bot's balance; that is not recipient top-up. |
| Telegram Accounts | **RESEARCH REQUIRED; NO-GO FOR AUTOMATION** | No official account provisioning API or authorized account-reseller/sourcing program was established. Account resale permission and sourcing legality are unresolved. |
| Bot as a digital-goods sales channel using Duitku | **NO-GO** | Telegram's Bot Developer Terms require digital goods/services sold inside a bot or mini app to use Telegram Stars. Existing Duitku must not be used for that in-bot checkout. |

These findings distinguish an API capability from permission to operate a commercial resale business. Official documentation of a method is not evidence of a reseller contract, supplier authorization, or right to resell accounts.

## Telegram Premium

**Provider:** Telegram Bot API, `giftPremiumSubscription`.  
**Product:** Premium gift/subscription for another Telegram user.  
**Mechanism and official status:** Official Bot API method; accepts `user_id`, `month_count`, `star_count`, and `text`. Documented month counts are 3, 6, and 12, with required Stars values 1000, 1500, and 2500 respectively. It returns `True` on success. The documented recipient is a numeric Telegram user ID, not a username. See [Bot API: giftPremiumSubscription](https://core.telegram.org/bots/api#giftpremiumsubscription).

**Commercial status:** The Bot API documents the gifting capability and the Bot Developer Terms document Stars-based digital sales. The material reviewed does not establish a general Telegram Premium reseller/wholesale program or expressly authorize a third party to resell these gifts at a markup. Treat commercial authorization, eligibility, applicable regional restrictions, and margin/reward terms as unresolved pending written confirmation or counsel review.

**Authentication and credentials:** Uses the bot token as a Bot API credential. It must be supplied through secret configuration, never stored in product/order tables, responses, or logs. The bot must hold sufficient Stars balance to perform the gift. No production credential is configured or tested by this phase.

**Request and response flow:** Core should create and price an order; only after authoritative payment confirmation should the existing fulfillment worker call a provider adapter. The adapter calls the official Bot API and records the returned result. `True` is an API acknowledgment, not independent proof that the recipient can use the subscription. The API requires a numeric user ID, so a username collected by the Phase 12 web checkout alone is insufficient. The recipient must be identified through a trustworthy Telegram identity-linking flow or an approved mapping; usernames are mutable and the Bot API does not document arbitrary username-to-ID lookup.

**Verification, webhooks, idempotency:** No gift-specific callback/webhook or provider-supplied idempotency key is documented. The Bot API exposes Stars transaction history, including transaction identifiers and Premium purchase partner details; it may provide reconciliation evidence, but this must be validated in a controlled test before relying on it. See [getStarTransactions](https://core.telegram.org/bots/api#getstartransactions) and [StarTransaction](https://core.telegram.org/bots/api#startransaction). Use the existing local order/attempt idempotency, serialize potentially duplicate gifts for a recipient/product, and treat a timeout as unknown. Do not blindly retry: reconcile transaction history and retain `FULFILLMENT_PENDING` or `RECONCILIATION_REQUIRED` if outcome cannot be proved.

**Rate limits and failures:** No method-specific quota was found in the reviewed method documentation. Follow generic Bot API throttling responses (including `retry_after` where supplied) and existing retry classification. Expected failures include invalid/ineligible recipient, insufficient bot Stars balance, bot API throttling, network timeout, and provider availability errors. Distinguish definitive rejection from unknown outcome.

**Refund/cancellation:** This is a gift purchase from the bot's Stars balance; the reviewed API method does not document reversing an already delivered gift. The Bot API's `refundStarPayment` is for refunding a user's Stars payment to the bot, not for reclaiming a separate Premium gift. A customer refund can therefore leave the provider cost unrecoverable. Telegram's [Bot Developer Terms](https://telegram.org/tos/bot-developers) also warn operators to consider the difficulty of reclaiming digital goods after chargeback.

**Decision:** **GO WITH LIMITATIONS** for an isolated official Bot API adapter only after commercial authorization and the payment model are resolved. The documented method supports 3/6/12 months, not Phase 12's 1-month variant. No real provider is implemented in this phase.

## Telegram Stars recipient balance

**Provider/API availability:** The official [Bot Payments for Stars](https://core.telegram.org/bots/payments-stars) documentation allows bots and mini apps to sell their own digital goods for Stars. A successful invoice credits the bot's Stars balance and emits a successful-payment update. It does not describe a Bot API operation to add Stars to another user's personal balance. The official [Stars API overview](https://core.telegram.org/api/stars) describes user-facing Stars capabilities, but the reviewed official documentation does not establish an authorized reseller top-up endpoint.

**Commercial and payment restrictions:** [Bot Developer Terms §6.2](https://telegram.org/tos/bot-developers) requires that digital goods/services sold in a TPA or bot be transacted exclusively using Telegram Stars, even if an external portal or other payment provider exists. The Stars payment guide requires answering `pre_checkout_query` within 10 seconds, waiting for `successful_payment` before fulfillment, storing Telegram's charge identifier, and supporting `/paysupport`/refund handling. Stars earned by the bot are subject to Telegram's balance/reward terms and restrictions; they are not interchangeable with a documented recipient top-up API.

**Authentication, verification, idempotency, and failure:** An invoice uses the bot token and XTR currency; Core must own order/payment state, deduplicate Telegram updates/charge IDs, and only mark paid from a verified successful-payment update. Refund via `refundStarPayment` reverses the buyer's payment to the bot; it does not fulfill a recipient balance top-up. Pre-checkout timeout, duplicate updates, refund, insufficient Stars, and interrupted fulfillment need explicit handling in a future implementation. Do not accept a bot callback or client message as payment confirmation.

**Decision:** **NO-GO** for the present product promise “Stars 50/100/250/500/1000 delivered to a recipient's balance.” Re-scope to a distinct Telegram Stars-priced digital good sold by the bot, or obtain documented authorization/API from a supplier that expressly supports recipient top-up and commercial resale. Do not use private MTProto automation or customer credentials as a substitute.

## Telegram Account sourcing and resale

**Provider/mechanism:** No official Telegram Bot API account-creation/provisioning method or official licensed account-reseller interface was found in the reviewed documentation. The Bot API is a bot interface, not an API for creating user accounts. No authorized supplier or legitimate inventory source was supplied or verified for this research.

**Authorization and terms:** The reviewed [Telegram Terms of Service](https://telegram.org/tos) and [Bot Developer Terms](https://telegram.org/tos/bot-developers) do not establish an affirmative account-resale authorization or a supplier program. This research does not conclude that resale is categorically prohibited; it concludes that permission and compliant sourcing are unverified. Bot Developer Terms additionally require digital goods sold in the bot to use Stars.

**Security and operational constraints:** Do not automate account creation/login, collect session strings, harvest credentials, or use unofficial/private APIs. Phase 12's encrypted inventory and protected handoff remain available for lawfully sourced stock, but are not evidence that sourcing or resale is authorized. Credentials must never be delivered as ordinary bot messages; any future approved delivery must reuse the protected Core handoff and audit controls.

**Decision:** **RESEARCH REQUIRED / NO-GO FOR AUTOMATION** until there is written platform/supplier authorization, a documented lawful source, commercial terms, and an agreed secure transfer process.

## Bot channel, webhook, and framework

**Channel capability:** Telegram's official [setWebhook](https://core.telegram.org/bots/api#setwebhook) supports a configured `secret_token`, sent back as `X-Telegram-Bot-Api-Secret-Token`. Telegram updates contain `update_id`; the bot should persist/deduplicate it. The official [User object](https://core.telegram.org/bots/api#user) identifies users by numeric `id`; `username` is optional and mutable.

**Framework:** No bot framework was present in the repository at audit time. grammY is a TypeScript-capable Bot API framework with webhook deployment guidance and advice to keep webhook handlers short. Sources: [grammY deployment types](https://grammy.dev/guide/deployment-types), [grammY project](https://github.com/grammyjs/grammY). If implementation is later approved, select one framework and pin/audit its version then; no dependency is added by this research.

**Target architecture:** If approved, run the bot as a private, non-root, hardened service behind the existing Nginx edge; do not publish a bot port or give the bot direct database access. It calls the existing Core API for product, order, payment, and handoff operations. Callback data is untrusted and must resolve to server-authorized Core state. Telegram update IDs and payment charge IDs require deduplication. Do not put credentials, secret handoff payloads, prices, or trusted order ownership in callback data.

**Payment gate:** As the current products are digital, an in-bot sales flow cannot simply reuse Duitku under the Bot Developer Terms. A Core-owned Telegram Stars payment adapter would need to map a successful Telegram payment into the existing payment/order state machine, verify update provenance, handle the 10-second pre-checkout deadline, refunds and support, and retain one order system. That adapter is not implemented here. Do not market an external Duitku checkout link surfaced inside the bot as a policy workaround; obtain platform/legal review for any distinct web-channel design.

## Repository fit and audit summary

Phase 12 already provides Telegram products, versioned Core pricing, authoritative checkout/order snapshots, recipient fulfillment, encrypted account inventory, transactional reservations, protected handoff, mock recipient provider, outbox/BullMQ workers, retry/idempotency/reconciliation, Duitku payment verification, and a single Nginx public edge. The repo has no bot package, Telegram webhook route, Telegram identity mapping, or Telegram Stars payment adapter. Recipient orders currently use Telegram usernames, which are inadequate for the official Premium gift method's numeric recipient requirement. No source, product, provider, payment, or Docker code was changed for Phase 13 research.

## Primary sources

- [Telegram Bot Developer Terms](https://telegram.org/tos/bot-developers)
- [Telegram Bot Payments for Stars](https://core.telegram.org/bots/payments-stars)
- [Telegram Bot API: giftPremiumSubscription](https://core.telegram.org/bots/api#giftpremiumsubscription)
- [Telegram Bot API: getStarTransactions](https://core.telegram.org/bots/api#getstartransactions)
- [Telegram Bot API: setWebhook](https://core.telegram.org/bots/api#setwebhook)
- [Telegram Bot API: User](https://core.telegram.org/bots/api#user)
- [Telegram Stars API overview](https://core.telegram.org/api/stars)
- [Telegram Terms of Service](https://telegram.org/tos)
- [grammY webhook deployment guide](https://grammy.dev/guide/deployment-types)
- [grammY source repository](https://github.com/grammyjs/grammY)
