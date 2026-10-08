# Phase 15 — Payment Feasibility

**Research date:** 2026-10-08  
**Scope:** Telegram Account sale initiated and completed in a Telegram Bot, with QRIS preferred. This is a capability audit, not an authorization to process live transactions.

## Executive result

| Question | Finding |
|---|---|
| Can the Bot API show a checkout interaction in Telegram? | **Yes.** It supports native invoices and inline keyboards. For digital products, the official Bot API invoice flow is Telegram Stars (`XTR`). |
| Can Duitku create a QRIS payment and return data for a QR? | **Yes, documented technically.** Duitku V2 `/merchant/v2/inquiry` documents `qrString`; merchants generate a QR image from that value. Duitku SNAP separately documents QR MPM generation (service code 47). This does not prove either feature is activated for this merchant account. |
| Can a QR be shown in a Telegram chat? | **Yes, technically.** Generate a QR image from `qrString` and upload it with Bot API `sendPhoto`. The customer can keep the order/payment instructions in Telegram and scan using a QRIS bank/wallet app. Payment app switching/camera access may still be required; QR display is not payment execution. |
| Does the existing Duitku/Core adapter support that UX? | **No, not yet.** It currently requires and returns `paymentUrl`; it drops `qrString`. Shared payment view exposes only a URL, and the bot does not exist. Core's verified callback/status flow is already reusable. |
| May Duitku QRIS be used for an account sold inside a Telegram bot? | **No under the current documented Telegram Bot Developer Terms if this account is treated as a digital good/virtual item.** Terms require Stars for digital goods/services sold in a bot, and specifically say external portals/providers do not change that. An account is very likely within that category, but Telegram does not name account resale specifically; obtain legal/platform confirmation rather than asserting a formal category ruling. |
| Is account resale/sourcing authorized? | **NOT VERIFIED.** Phase 13 found no authorized sourcing/provisioning mechanism. Existing stocked inventory does not establish resale rights or legitimate source/transfer. |
| Is production enablement approved? | **BLOCKED / NOT VERIFIED.** QRIS inside this digital-goods bot conflicts with the documented Stars-only rule; merchant QRIS activation and lawful account resale are also unverified. |

## 1. In-Telegram checkout and QRIS presentation

The Bot API can render checkout choices and payment instructions as normal bot messages. Duitku's merchant API is not a Telegram invoice/payment provider: it creates a Duitku transaction, returns payment instructions, and sends an HTTP callback to the merchant. Duitku V2's response includes a QR string for QR payment methods. Its docs state that a merchant can encode `qrString` as a QR image for its own payment view. Telegram Bot API `sendPhoto` can send an uploaded photo. Therefore a technical flow can render the QR in the Telegram conversation without opening a website checkout page:

```text
Core creates Duitku QRIS attempt
 → Core gets qrString
 → trusted server generates QR image
 → bot uploads image + order amount/expiry to Telegram chat
 → payer scans with a supported bank/wallet app
 → Duitku callback reaches Core
 → Core verifies callback then fetches authoritative Duitku status
```

This is a payment presentation capability, not evidence QRIS can be used for this Telegram Bot digital-account transaction. QRIS also requires a separate scanner/payment app; same-device ergonomics depend on the customer's apps/device and cannot be guaranteed by the Bot API. The bot must never trust a “paid” button or user message.

## 2. Telegram payment rule for this product

Telegram Bot Developer Terms §6.2 say transactions for digital goods/services in a third-party bot application cannot be processed through third-party payment providers and must use Telegram Stars. The official Stars payment guide says the invoice is paid in Telegram with currency `XTR`, and that third-party provider checkout pages are not an exception to the in-Telegram rule.

The material reviewed does not specifically name “sale of Telegram accounts.” Given the product is an account/digital asset and the terms also discuss digital products and virtual items, treating this as a digital good is the conservative and strongly indicated reading. The terms also discourage real-time sales of digital/virtual products that cannot be reclaimed after disputes. This is an interpretation for risk management, not a legal opinion or proof Telegram has approved this business model.

Consequences:

- Do not implement or enable a bot flow that sells this account for Duitku QRIS/VA/e-wallet inside Telegram under the current terms.
- The native Telegram payment route is a Stars invoice (`sendInvoice`, currency `XTR`, no third-party provider token) and the bot must fulfill only after a trusted `successful_payment` update.
- Stars would need explicit Core product price values in XTR, durable Telegram payment/charge records, update and charge deduplication, pre-checkout validation within Telegram's time limit, refund/support, and order-to-invoice binding. The current Core is IDR-only and Duitku-based; none of those pieces exists. Do not convert IDR price to Stars without an approved pricing rule.
- If written Telegram/legal review determines the account sale is not a digital good within §6.2 or approves a specific exception, retain that written basis and verify the payment provider's use-case approval before revisiting QRIS.

## 3. Duitku audit against this repository

Official Duitku V2 documentation states:

- `POST /webapi/api/merchant/v2/inquiry` creates the transaction and returns `reference`, `paymentUrl`, `amount`, and for QR payment `qrString`.
- Merchant projects can query active payment methods; codes vary by account activation. The current adapter's accepted methods include `SP`, `SQ`, and `NQ` as QRIS variants, but deployment configuration and current merchant activation are not present in this repository.
- The documented QRIS expiry defaults/maxima vary by payment method. Core already computes a method-specific close window from its configured order deadline.
- Duitku sends a server-to-server callback. Existing Core validates the HMAC signature, treats callback fields only as a trigger, then fetches Duitku transaction status and checks amount/order before applying an idempotent Core transition.
- Duitku V2 documentation says QR display can use the returned QR string; it does not document Telegram Bot API integration or an in-Telegram-specific payment product.
- Duitku's separate SNAP API documents QR MPM generation and notification, but SNAP credential/product activation and merchant eligibility are not configured or verified here.

Repository gaps for a future permitted own-web/other-channel QRIS UX:

- Extend the gateway result with typed presentation data (e.g. QRIS payload), validate/limit its format, persist it securely for payment retrieval, and do not log it.
- Generate QR locally with a maintained library and upload the image through the bot; never use a third-party QR-image URL that receives payment payloads.
- Extend safe payment views with a method-specific instruction/image mechanism, keeping provider references/secrets private.
- Add QR payment webhook/late-payment, expiry and duplicate callback tests. Existing verified-by-fetch and idempotency logic should remain authoritative.

Those changes are not implemented because the intended in-bot Duitku transaction is blocked by the current Telegram payment rule, and the Core's compliant Stars alternative has no product pricing decision.

## 4. Payment authority

For a Duitku transaction, Core remains the payment authority: callback authenticity is checked; callback does not decide outcome; Core fetches the transaction status from Duitku, verifies merchant order reference/amount/currency, and atomically updates the payment/order/outbox. The current verified flow is appropriate to reuse if a channel is permitted.

For a Telegram Stars invoice, Telegram sends the Bot API `pre_checkout_query` and then `successful_payment`; neither a browser return nor a customer assertion is sufficient. Core must durably authenticate the webhook secret, validate expected invoice payload/order/user/currency/amount, deduplicate `update_id` and Telegram `telegram_payment_charge_id`/`provider_payment_charge_id` as applicable, and create the payment/order-confirmation transition once. The bot cannot call fulfillment directly. This integration is absent.

## 5. Bot API presentation limits

- A Bot API bot can send invoice/payment messages to private chats; Stars digital-goods invoices are native Telegram UI.
- A bot can send a photo (`sendPhoto`) using an uploaded file. QRIS requires the application to turn Duitku's QR data into an image; the Bot API does not render raw Duitku QR payloads automatically.
- Banks/wallets are separate payment apps. Telegram cannot make the user complete QRIS payment entirely inside a bot message.
- Payment callbacks/webhooks are server events; the bot must not infer payment from the user's interaction with the payment message.

## 6. Existing Core and operational readiness

- Catalog availability is computed by Core using active product/price and eligible source balance.
- Orders snapshot selected price and product configuration; clients do not set the total or fulfillment type.
- Duitku gateway and webhook verification are in `apps/api/src/modules/payments/infrastructure/duitku/`; inventory/fulfillment reservation and account handoff remain existing Core services.
- No Telegram Bot, bot identity mapping, bot order association, Telegram payment processing, or notification consumer currently exists.
- Existing Duitku callback is routed through the public Nginx `/api/` path to Core; there is no bot webhook route or Telegram webhook secret configuration.

## Official sources

- [Telegram Bot Developer Terms, §6.2 and §6.2.1](https://telegram.org/tos/bot-developers)
- [Telegram Bot Payments for Stars](https://core.telegram.org/bots/payments-stars)
- [Telegram Bot API: sendPhoto](https://core.telegram.org/bots/api#sendphoto)
- [Telegram Bot API: sendInvoice](https://core.telegram.org/bots/api#sendinvoice)
- [Duitku API Reference: transaction and QR string](https://docs.duitku.com/api/en/)
- [Duitku SNAP API: QR MPM](https://docs.duitku.com/snap-api/en/)
- [Midtrans official QRIS API](https://docs.midtrans.com/reference/qris)
- [Midtrans official notifications](https://docs.midtrans.com/docs/https-notification-webhooks)
- [Xendit official QRIS reference](https://docs.xendit.co/docs/qris)
- [Xendit official Payment Request API](https://docs.xendit.co/apidocs/create-payment-request)
- [Xendit official payment webhooks](https://docs.xendit.co/apidocs/payment-webhook-notification)
