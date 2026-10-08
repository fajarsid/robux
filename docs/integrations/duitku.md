# Duitku integration contract

**Source:** Duitku API Reference (English), https://docs.duitku.com/api/en/
**Retrieved:** 2026-10-05. Changelog on the page ends at "Version 2.0, Sep 2026" (latest entries: Sep 2026 "Remove payment channel QRIS Gudang Voucher", Jun 2026 "Add customerName issuer account info for qris on callback", Apr 2026 "Signature enhancement using HMAC and set obsolete md5 and sha256").
**Used by:** `apps/api/src/modules/payments/infrastructure/duitku/` only (ARCHITECTURE.md §6.2, R-03).

This file records what the official documentation says, and the decisions we took where it is silent or inconsistent. Nothing in the adapter may rely on behaviour that is not listed here. When Duitku changes its documentation, update this file first, then the adapter and its tests.

---

## 1. Environments

| Environment | Base URL |
|-------------|----------|
| Sandbox ("Development") | `https://sandbox.duitku.com/webapi/api/` |
| Production | `https://passport.duitku.com/webapi/api/` |

The merchant code ("project code") and API key come from the project in the Duitku merchant portal. The documentation notes that sandbox and production credentials differ. Configuration: `DUITKU_ENVIRONMENT=sandbox|production`, secrets `DUITKU_MERCHANT_CODE`, `DUITKU_API_KEY`.

## 2. Signatures

All signatures are `HMAC_SHA256(stringToSign, apiKey)`, output as **lowercase hex** (the PHP samples use `hash_hmac('sha256', $stringToSign, $apiKey)`). The page states that the earlier MD5 and plain SHA-256 methods are obsolete (changelog Apr 2026).

| Operation | stringToSign |
|-----------|--------------|
| Get Payment Method | `merchantcode + paymentAmount + datetime` |
| Request Transaction (inquiry) | `merchantCode + merchantOrderId + paymentAmount` |
| Callback | `merchantcode + amount + merchantOrderId` |
| Check Transaction | `merchantCode + merchantOrderId` |

Concatenation is plain string concatenation with no separator.

## 3. Request Transaction (inquiry)

`POST {base}merchant/v2/inquiry`, `Content-Type: application/json`.

| Parameter | Type | Required | Notes |
|-----------|------|:-:|-------|
| `merchantCode` | string(50) | ✓ | |
| `paymentAmount` | integer | ✓ | No decimals (`40000` = Rp40.000) |
| `paymentMethod` | string(2) | ✓ | Code from §7 |
| `merchantOrderId` | string(50) | ✓ | "Every request for a new transaction must use a new ID." |
| `productDetails` | string(255) | ✓ | |
| `email` | string(255) | ✓ | HTTP 400 table: "length of email can't > 50" |
| `customerVaName` | string(20) | ✓ | "The name that would be shown at bank payment system." |
| `phoneNumber` | string(50) | ✗ | |
| `additionalParam` | string(255) | ✗ | Must be URL encoded if used |
| `merchantUserInfo` | string(255) | ✗ | |
| `itemDetails` | ItemDetails[] | ✗ | `{ name, price (integer), quantity (integer) }`; "Make sure the nominal paymentAmount is equal to the amount of the existing itemDetails nominal" |
| `customerDetail` | CustomerDetail | ✗ | Required for credit card and "Credit" (paylater) methods |
| `callbackUrl` | string(255) | ✓ | |
| `returnUrl` | string(255) | ✓ | Redirect after leaving the payment page, paid or not |
| `signature` | string(255) | ✓ | §2 |
| `expiryPeriod` | int | ✗ | Minutes; see §6 |
| `accountLink` | AccountLink | ✗ | OVO/ShopeePay account link only |
| `creditCardDetail` | CreditCardDetail | ✗ | Credit card only |

Response (`application/json`): `merchantCode`, `reference` (Duitku reference, "need to be save on your system"), `paymentUrl`, `vaNumber`, `qrString`, `appUrl` (sample shows `AppUrl`), `amount`, `statusCode` (`00` success), `statusMessage`.

HTTP codes documented: 200 SUCCESS; 400 (minimum payment 10000 IDR, maximum exceeded, missing paymentMethod/merchantOrderId, merchantOrderId > 50, invalid email, email > 50, phoneNumber > 50, customerVaName empty for the channel); 401 "Wrong signature"; 404 "Merchant not found" / "Payment channel not available"; 409 "Payment amount must be equal to all item price".

## 4. Callback

Duitku sends `POST` to `callbackUrl` with `Content-Type: application/x-www-form-urlencoded`.

| Field | Notes |
|-------|-------|
| `merchantCode` | |
| `amount` | Transaction amount (sample `150000`) |
| `merchantOrderId` | Our id from the inquiry |
| `productDetail` | |
| `additionalParam` | |
| `paymentCode` | Payment method code |
| `resultCode` | `00` Success, `01` Failed |
| `merchantUserId` | Customer username/email on the merchant site |
| `reference` | Duitku reference |
| `signature` | `HMAC_SHA256(merchantcode + amount + merchantOrderId, apiKey)` |
| `publisherOrderId` | "Unique transaction payment number from Duitku" |
| `spUserHash` | ShopeePay only |
| `settlementDate` | `YYYY-MM-DD` estimate |
| `issuerCode` | QRIS issuer |
| `customerName` | QRIS issuer account identifier, may be masked (PII) |

Requirements: publicly reachable URL on port 80 or 443; respond **HTTP 200**. Duitku resends when it does not receive HTTP 200, up to 5 attempts, then emails a failed-callback notice; callbacks can be resent from the dashboard.

Outgoing IPs published for whitelisting: production `182.23.85.14, 103.177.101.190, 182.23.85.8, 182.23.85.9, 182.23.85.10, 182.23.85.13, 103.177.101.184, 103.177.101.185, 103.177.101.186, 103.177.101.189`; sandbox `182.23.85.11, 182.23.85.12, 103.177.101.187, 103.177.101.188`.

**Security property that drives our design:** the callback signature covers only `merchantCode`, `amount` and `merchantOrderId`. `resultCode` and `reference` are **not signed**, and the signature has no timestamp or nonce, so any captured callback for an order can be replayed with a different `resultCode`. We therefore treat a callback as a *trigger only* and decide the payment outcome from Check Transaction (§5), called by us over TLS with our own signature (verify-by-fetch). The documentation itself recommends this: "You can insert a transaction check when you receive a callback so that the payment status is guaranteed."

## 5. Check Transaction

`POST {base}merchant/transactionStatus`. Request fields `merchantCode`, `merchantOrderId`, `signature` (§2).

Response: `merchantOrderId`, `reference`, `amount` (sample `"100000"`), `fee` (sample `"0.00"`), `statusCode` (`00` Success, `01` Process, `02` Failed/Expired), `statusMessage`.

Rate note from the page: "Don't automate to repeatedly hit this API … It'll block your hit for about one hour when you have the maximum hit rate." We call it only when a callback arrives (and later from explicit reconciliation), never on a polling loop or customer page view.

**Documentation inconsistency:** the section header says `Type: x-www-form-urlencoded`, while both the PHP and the curl samples send JSON with `Content-Type: application/json`. We send JSON, as in the samples. If sandbox testing shows otherwise, change only `DuitkuPaymentGateway` and this note.

## 6. Expiry (`expiryPeriod`)

Values used when `expiryPeriod` is not sent ("Default or NULL") and the maximum accepted:

| Channel | Default | Maximum |
|---------|---------|---------|
| Credit Card | 30 min* | |
| Virtual Account | 1440 min | >1440 min |
| Retail | 1440 min | >1440 min |
| OVO | 10 min** | 1440 min |
| ShopeePay Apps | 10 min | 60 min |
| LinkAja Apps | 24 min* | 1440 min |
| DANA | 1440 min | 1440 min |
| ShopeePay Account Link | 30 min* | |
| OVO Account Link | 15 min* | |
| QRIS Payment | 10 min | 60 min |
| NOBU QRIS | 24 min | 1440 min |
| Indodana Paylater | 1440 min | 1440 min |
| ATOME | 720 min | 720 min |
| Jenius Pay | 10 min | 10 min |
| Tokopedia | 1440 min | 1440 min |

\* the default is always used and the requested value is ignored. \*\* for OVO the value applies on the Duitku checkout page before the customer clicks "pay now".

The table names channels, not codes. Our code-to-row mapping: QRIS Payment = `SP`, `SQ`; NOBU QRIS = `NQ`; Retail = `FT`, `IR`; Tokopedia = `T1`, `T2`, `T3`.

## 7. Payment method codes

Credit card `VC`. Virtual account `BC` (BCA), `M2` (Mandiri), `VA` (Maybank), `I1` (BNI), `B1` (CIMB Niaga), `BT` (Permata), `A1` (ATM Bersama), `AG` (Artha Graha), `NC` (Neo Commerce), `BR` (BRIVA), `S1` (Sahabat Sampoerna), `DM` (Danamon), `BV` (BSI). Retail `FT` (Pegadaian/ALFA/Pos), `IR` (Indomaret). E-wallet `OV` (OVO), `SA` (ShopeePay Apps), `LF` (LinkAja fixed fee), `LA` (LinkAja percentage fee), `DA` (DANA), `SL` (ShopeePay Account Link), `OL` (OVO Account Link). QRIS `SP` (ShopeePay), `NQ` (Nobu), `SQ` (Nusapay). Credit/paylater `DN` (Indodana), `AT` (ATOME). E-banking `JP` (Jenius Pay). E-commerce `T1`, `T2`, `T3` (Tokopedia).

Which of these are active depends on the merchant project; Get Payment Method returns the active ones with fees.

## 8. Redirect (`returnUrl`)

`GET returnUrl?merchantOrderId=…&resultCode=…&reference=…` with `resultCode` `00` Success, `01` Pending, `02` Canceled. The documentation says: "Do not use resultCode to update payment status … the URL can be changed manually by the customer." Our return page only reads status from our API.

---

## 9. Decisions taken for this platform

| Topic | Decision | Why |
|-------|----------|-----|
| Payment status authority | Check Transaction, never the callback fields. A callback starts a verification; `resultCode` alone changes nothing. | Callback signature does not cover `resultCode`/`reference` (§4). |
| Currency | IDR only. Duitku documents no currency field; amounts are integer rupiah. The adapter refuses non-IDR and non-whole amounts. | DATABASE.md §3, D-06. |
| Amount comparison | Exact decimal equality between our payment amount and both the callback `amount` and the Check Transaction `amount`. Any difference → reconciliation, never PAID. | SECURITY.md §5. |
| `merchantOrderId` | `<order number>-<attempt number>`, e.g. `RBX-20261005-00042-1` (≤ 50 chars). New id per attempt. | Unique per request (§3); readable for support. It is not an access credential. |
| `customerVaName` | The order number (18 chars ≤ 20). | Required field; shows the customer which order the bill belongs to without sending personal data. |
| `itemDetails` | One item: product summary, `price = paymentAmount`, `quantity = 1`. | Satisfies "paymentAmount equals itemDetails" under any reading of the rule. |
| `customerDetail`, `phoneNumber`, `merchantUserInfo`, `additionalParam` | Not sent. | Not required for the supported methods; less personal data leaves the platform. |
| Supported methods | Virtual accounts, retail, `OV`, `SA`, `LF`, `LA`, `DA`, QRIS (`SP`, `NQ`, `SQ`), `JP`, `T1`–`T3`. The operator enables the subset active in the Duitku project with `DUITKU_PAYMENT_METHODS`. | `VC`, `DN`, `AT` require `customerDetail`; `OL`, `SL` require an account-link credential. Not supported until a decision requires them. |
| Expiry | We send `expiryPeriod` = minutes until (order payment deadline − 5 min), capped by the method maximum (§6). Methods whose default is fixed (`LF`, `LA`) are refused when their fixed window would outlast that limit. | The gateway attempt must close before the order expires, leaving 5 minutes for the callback to arrive before the expiry sweep. |
| Callback response | HTTP 200 once the callback is processed or recognised as a duplicate or an unknown order. HTTP 503 when Check Transaction cannot be reached, so Duitku retries. 400/401/403 for malformed, badly signed or disallowed requests. | §4 retry behaviour. |
| Callback IP allow-list | Optional, `DUITKU_CALLBACK_ALLOWED_IPS` (comma-separated, values from §4). Off by default. | Defence in depth; verify-by-fetch is the real control. |
| Get Payment Method | Not used yet. | The `datetime` timezone is not documented; the enabled set is configuration instead. |
| Refund, cancel/void | Not implemented. The page lists "Support Void" for OVO and ShopeePay Apps but documents no void or refund endpoint. | Never invent an API (CLAUDE.md). |

## 10. Open items (need Duitku or the owner)

1. Sandbox merchant code and API key, to run the adapter against the sandbox (no automated test calls Duitku).
2. Confirmation that the Duitku project accepts this merchant category (R-01, R-03).
3. The payment methods active in the project (sets `DUITKU_PAYMENT_METHODS`).
4. Callback and return URLs registered in the dashboard, if Duitku requires registration in addition to the per-request URLs.
5. Content type actually accepted by Check Transaction (§5 inconsistency).
6. Whether a paid attempt can still be paid twice (for example a VA reused after payment); the platform detects a second PAID attempt and opens a reconciliation case, but Duitku does not document it.
