# Phase 15 — Payment Provider Evaluation

**Evaluation date:** 2026-10-08  
**Purpose:** compare documented QRIS mechanics for a Telegram Account storefront. This is technical capability only; merchant activation, contract approval, Telegram policy, and resale authorization are separate gates.

| Capability | Duitku | Midtrans | Xendit |
|---|---|---|---|
| QRIS channel documented | **Yes.** V2 method codes include QRIS options; account-specific live methods must be queried/confirmed. | **Yes.** Official QRIS charge API documented; supported acquiring options shown by Midtrans include GoPay and ShopeePay. | **Yes.** Official QRIS method documented for Indonesia (IDR). |
| Dynamic payment session/API | **Yes, documented.** V2 `/merchant/v2/inquiry`; separate SNAP QR MPM API also exists. SNAP access is not verified for this merchant. | **Yes.** `/v2/charge` creates a transaction. | **Yes.** Payments API v3 `POST /v3/payment_requests`; use a QRIS channel/method supported by account. |
| QR presentation material | **Yes.** V2 response exposes `qrString`; merchant generates QR image. QR MPM product generates payment QR. | **Yes.** API returns a QR code image URL/action; docs instruct to show rendered QR. | **Yes.** QRIS is a QR-code method; exact response fields depend on selected API/version and must be verified in a merchant sandbox. |
| Can display within Telegram chat | **Technically yes** after trusted server-side QR image generation and Bot API `sendPhoto`. | **Technically yes** if server retrieves/creates the documented QR image and uploads it with `sendPhoto`. | **Technically yes** if its response provides a usable QR image/payload and server sends that image. |
| Webhook/notification | **Yes.** Callback documented; existing Core verifies signature and fetches status before marking paid. | **Yes.** Official HTTP notification/webhook docs. | **Yes.** Payment capture/failure/expiry webhook docs; callback token/signature verification is documented. |
| Current repository adapter | Existing adapter supports Duitku payment/status but discards `qrString`; exposes only payment URL. | Not integrated. | Not integrated. |
| Merchant credentials/activation available here | **No.** Sandbox/live merchant access and QRIS activation are not verified. | **No.** No account, credentials, or contract verified. | **No.** No account, credentials, or contract verified. |
| Telegram in-bot digital-account sale with QRIS | **Not permitted under current documented Telegram rule** if product is a digital good; third-party providers are disallowed for digital goods sold in bots. | Same Telegram restriction. | Same Telegram restriction. |
| Decision for Phase 15 in-bot sale | **NO-GO for checkout implementation until compliant payment model is established.** Reusable on channels where permitted. | **Not selected.** It cannot override Telegram's Stars-only digital-goods rule; switching provider provides no policy solution. | **Not selected.** It cannot override Telegram's Stars-only digital-goods rule; switching provider provides no policy solution. |

## Decision

No provider switch is recommended. Duitku is technically capable of API-created QRIS sessions and a merchant-rendered QR presentation, but the repository's current adapter does not expose the QR payload. Midtrans and Xendit also document QRIS APIs/webhooks, but neither changes Telegram's payment rule. This is a feasibility comparison, not a statement that any provider has approved the merchant's account-sale business model.

If the payment flow is for a non-Telegram channel where QRIS is allowed, extend the existing Core `PaymentGateway` adapter rather than putting provider calls in the bot. Keep the Core callback verification and fetch-by-reference confirmation path. If checkout remains inside Telegram for this digital product, proceed only with a Core-owned Telegram Stars integration and approved XTR pricing; do not display QRIS as an alternate rail.

## Sources

- [Duitku API Reference — QR string, inquiry, callback, and status](https://docs.duitku.com/api/en/)
- [Duitku SNAP API — QR MPM](https://docs.duitku.com/snap-api/en/)
- [Midtrans QRIS API](https://docs.midtrans.com/reference/qris)
- [Midtrans HTTP notification/webhook documentation](https://docs.midtrans.com/docs/https-notification-webhooks)
- [Xendit QRIS documentation](https://docs.xendit.co/docs/qris)
- [Xendit Payment Request API](https://docs.xendit.co/apidocs/create-payment-request)
- [Xendit Payment webhook notification](https://docs.xendit.co/apidocs/payment-webhook-notification)
- [Telegram Bot Developer Terms](https://telegram.org/tos/bot-developers)
- [Telegram Stars payment documentation](https://core.telegram.org/bots/payments-stars)
