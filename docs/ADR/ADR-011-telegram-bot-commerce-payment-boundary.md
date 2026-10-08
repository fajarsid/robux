# ADR-011: Telegram bot commerce payment boundary

**Status:** Accepted for the Phase 13 integration gate  
**Date:** 2026-10-08

## Context

Phase 12 uses Duitku for Core checkout and payment confirmation. Telegram's Bot Developer Terms state that digital goods or services sold inside Telegram bots and mini apps must use Telegram Stars. The bot therefore cannot create a competing payment/order flow or treat the existing Duitku integration as an in-bot digital-goods payment mechanism. Telegram also documents Premium gifting from a bot's Stars balance, but that API capability does not establish a general commercial resale agreement. There is no official Bot API method documented for topping up another user's Stars balance.

## Decision

- The bot, if implemented, is a sales channel/client of the Digital Fulfillment Core. Core remains authoritative for catalog, price, customer/order, payment state, inventory, fulfillment, idempotency, and reconciliation.
- Do not offer Core digital products for purchase inside the bot using Duitku. A future in-bot checkout requires a Telegram Stars payment adapter integrated into the existing Core payment/order lifecycle, including verified successful-payment updates, update/charge deduplication, refund handling, and Telegram support requirements.
- Do not implement recipient Stars top-up without a documented, commercially authorized mechanism.
- Keep Premium gifting behind the existing provider abstraction and disabled for production until commercial terms are verified. Treat timeouts as unknown and reconcile; never blindly repeat a non-idempotent gift request.
- Do not implement account sourcing or account automation without a verified lawful supplier and platform/commercial authorization.
- If a bot is later approved, use Telegram webhooks through the existing Nginx edge and private Core API; do not add public ports or a second order/database system.

## Consequences

This phase documents a policy and capability gate; it does not add a bot service, Stars payment adapter, Telegram provider, credentials, or dependency. The Phase 12 mock remains development/test-only. Product/payment design and commercial authorization must be resolved before production Telegram checkout is enabled.

## Sources

- [Telegram Bot Developer Terms](https://telegram.org/tos/bot-developers)
- [Telegram Bot Payments for Stars](https://core.telegram.org/bots/payments-stars)
- [Bot API: giftPremiumSubscription](https://core.telegram.org/bots/api#giftpremiumsubscription)
