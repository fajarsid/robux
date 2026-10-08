# Security

**Status:** Phase 0 baseline. Every control below is *planned*; none is implemented yet. The "Phase" column says where it lands. This document is updated as controls ship, and reviewed in full before production (Phase 16).

---

## 1. Assets

| Asset                                   | Why it matters |
|-----------------------------------------|----------------|
| Customer payments and order state       | Direct financial loss, chargebacks. |
| Fulfillment source balances and credentials | Whoever holds them can drain inventory. Highest-value secret in the system. |
| Payment gateway keys and webhook secret | Forged "PAID" events = free fulfillment. |
| Admin accounts                          | Can refund, retry, change prices, enable sources. |
| Customer PII (email, Roblox user id, IP) | Privacy obligations (Indonesian PDP Law UU 27/2022 likely applies; to confirm). |
| Audit log                               | Evidence for disputes and incident response. |

## 2. Threat model (summary)

| Threat                                              | Primary controls |
|-----------------------------------------------------|------------------|
| Forged or replayed payment webhook                  | Signature verification on raw body, timestamp tolerance, event-id uniqueness, verify-by-fetch, amount/currency/reference match. |
| Client-side price or amount tampering               | Server-side pricing only; client sends product id + quantity. |
| Double fulfillment (retries, duplicate events, races) | Idempotency keys, conditional state transitions, DB unique constraints, verify-before-retry. |
| Inventory oversell under concurrency                | Atomic conditional UPDATE, CHECK constraints, ordered locking. |
| Admin account takeover                              | Argon2id, optional TOTP (enforced once enabled), recovery codes, rate limits, lockout, session rotation, optional Cloudflare Access on `/console`. |
| Privilege escalation (OPERATOR → ADMIN actions)     | Role + permission guards on every admin route, deny by default, tests per route. |
| Order enumeration via sequential order numbers      | Guest tracking uses a 256-bit random token in `/order/{token}`, hashed at rest, rate-limited, uniform 404s; order numbers are never access keys (D-03). |
| Credential leakage through logs or error tracking   | Central redaction, no secrets in job payloads, error responses never include internals. |
| Customer Roblox credential capture                  | Never collected. See §6. |
| SSRF via user-supplied URLs                         | No user-controlled outbound URLs. Avatar URLs come from Roblox responses and are allow-listed by host. |
| Direct access to Postgres/Redis                     | Not published, only on the `internal: true` `data` network, passwords required. |
| Origin bypass of Cloudflare                         | Origin firewall allows only Cloudflare IP ranges; Authenticated Origin Pulls. |
| Supply-chain compromise                             | Lockfile, `pnpm audit` in CI, Dependabot/Renovate, pinned base images. |

---

## 3. Authentication and sessions

Implemented in Phase 3 (`apps/api/src/modules/auth`). Design record: ADR-008.

| Control | Implementation |
|---------|----------------|
| Identity separation | Application accounts (customer, staff) are unrelated to Roblox accounts. Request schemas are strict objects, so extra fields such as a Roblox password are rejected with 400 and never stored (tested). The login and register pages state this to the user. |
| Password hashing | Argon2id, OWASP minimum parameters (19 MiB, t=2, p=1); rehash on login when parameters change. Hashes are never returned by any API. Unknown accounts are verified against a dummy hash so timing does not reveal account existence. |
| Sessions | Opaque 256-bit token in `__Host-sid` (`HttpOnly; Secure; SameSite=Lax; Path=/`, no `Domain`, host-only on the frontend host). Only the SHA-256 hash is stored (`user_sessions`), in PostgreSQL. No identity data in client-readable cookies. |
| Lifetimes | Customer: idle 7 days, absolute 30 days. Staff: idle 30 min, absolute 12 h. Staff session waiting for 2FA: 5 min. Idle expiry slides at most once a minute. |
| Fixation | Login always issues a new token; a session presented at login time is revoked (tested). |
| Rotation | New token after 2FA (enrollment, code, recovery code) and after a password change. Presenting a token that was rotated away while its successor is alive revokes the whole session family (tested, and observed during the production check). |
| Invalidation | Logout revokes the session family and clears the cookie. A password change revokes every other session of the user. A staff role change revokes the target sessions. A suspended user is signed out immediately. |
| Admin 2FA | TOTP (RFC 6238, SHA-1, 6 digits, 30 s, verified against the RFC test vectors), **optional per staff member** (owner decision 2026-10-05, replacing the earlier mandatory rule). Staff without TOTP sign in with password and get a normal staff session (state `NOT_ENROLLED`); staff who enabled TOTP get a 5-minute pending session that grants no permission until the code or a recovery code is verified (`PENDING`, `TWO_FACTOR_REQUIRED`), and a pending session cannot replace the factor. Enrolment is in Console → Security (`/admin/auth/2fa/setup` and `/activate`, unchanged); recovery codes are shown once. Disabling 2FA and regenerating recovery codes have no API yet and are shown as unavailable. Secret encrypted at rest with AES-256-GCM (`TOTP_ENCRYPTION_KEY`, versioned). One step of drift; a used step cannot be replayed (compare-and-set on `last_used_step`). Risk accepted by the owner: a leaked staff password alone gives access to a staff account without 2FA; the dashboard reminds staff without 2FA to enable it. |
| Recovery codes | 10 codes (`XXXXX-XXXXX`, 50 bits each), shown once at enrollment, stored as Argon2id hashes, consumed with a conditional update so each works exactly once (tested). Use is audited. |
| Login protection | Same error, status and comparable timing for wrong password, unknown email, suspended account or wrong portal. Staff cannot sign in through the customer login and vice versa. `login_attempts` records SHA-256 of the email, IP, outcome and reason, never the password. Rate limits in section 7. |
| Account enumeration | Login is fully generic. **Known limitation:** registering an already-registered email returns a vague `ACCOUNT_UNAVAILABLE` (409); without email verification this cannot be hidden completely. Mitigated by 5 registrations per hour per IP; replaced by a verify-by-email flow in Phase 14. |
| Password reset | Not implemented yet (needs email delivery, Phase 14). Until then a SUPER_ADMIN provisions a new staff account with the CLI. |
| Staff provisioning | No default production credentials. `node dist/cli/create-staff-account.js --email ... --role ...` creates a staff account with a random one-time password printed once; TOTP enrollment is forced at first login. Development accounts (`@dev.robux.test`, seeded only outside production) make the production API refuse to start, as does any staff account still using the development password (`ProductionAccountSafetyCheck`, verified against a dev-seeded database). |

**PRD deviation (D-04):** PRD sections 42 and 65 mention JWT and refresh-token rotation. Server-side opaque sessions with rotation meet the intent with immediate revocation. `JWT_SECRET`/`JWT_REFRESH_SECRET` are not used; the API needs `CSRF_SECRET` and `TOTP_ENCRYPTION_KEY` as secret files.

## 4. Authorization

- Deny by default: every route requires a session unless marked `@Public()`. Global guard order: authentication, rate limit, CSRF, permissions.
- Permissions are explicit (`modules/auth/domain/permissions.ts`) and checked by `@RequirePermissions(...)`; staff permissions additionally require a 2FA-verified session. Backend authorization is authoritative; frontend redirects are convenience only.
- Object-level access: customer order queries are scoped by owner in the repository (`WHERE id = $1 AND user_id = $2`); another customer order and a missing order both return 404 (tested). Guest tracking is scoped by the token hash.

| Capability | CUSTOMER | OPERATOR | ADMIN | SUPER_ADMIN |
|------------|:-:|:-:|:-:|:-:|
| Own account; own orders | both | account only | account only | account only |
| Staff console, read any order, retry, fulfillment monitoring, customer support read, product and inventory read | | yes | yes | yes |
| Cancel and refund orders, product and pricing write, inventory management, notifications, reports, operational settings | | | yes | yes |
| Audit log read (never modify or delete) | | | yes | yes |
| Security settings, provider credentials, staff and role administration | | | | yes |
| Refund of a FULFILLED order (`payments.refund`) | | | | yes |

Role administration (`PATCH /api/v1/admin/staff/:id/role`, SUPER_ADMIN only) accepts staff roles only, never changes the caller role, never promotes a customer, is audited with before/after values and signs the target out.

**Owner decisions (2026-10-05):** OPERATOR may not cancel orders. ADMIN may read the audit log (append-only; the Phase 13 audit viewer filters security-sensitive fields). Refunding a FULFILLED order requires the dedicated `payments.refund` permission, held only by SUPER_ADMIN; `orders.refund` (ADMIN) covers eligible, not yet fulfilled orders. Refunds are not implemented yet; when they are, they must be explicitly authorized, idempotent, audited, history-preserving, protected against duplicates and validated against the refundable amount.

- Orders (Phase 5): staff accounts cannot place orders (`STAFF_CANNOT_ORDER`), so staff permissions never mix with customer ownership. Customer cancellation is scoped to the owner (another customer order is a 404, tested); guest cancellation requires the tracking token; staff cancellation requires `orders.cancel` (ADMIN, SUPER_ADMIN; OPERATOR denied, tested), a reason, and is audited once with before/after.
- Product cost price and margin are business-sensitive: returned only to callers with `pricing.write` (ADMIN, SUPER_ADMIN); OPERATOR reads products without them; customers never see them (tested).

- Audit logs cannot be modified through the application and are protected by append-only triggers; a separate restricted database role follows in Phase 16 (C-16).
- Risky admin actions (refund, cancel, manual fulfillment, source enable/disable, bulk price change) require a confirmation step and a reason string; all audited.

## 5. Payments and webhooks

Implemented in Phase 6 for Duitku (`modules/payments`, contract in `docs/integrations/duitku.md`, flow in ARCHITECTURE.md §6.2).

1. Duitku signs form fields, not a raw body: `HMAC-SHA256(merchantCode + amount + merchantOrderId, apiKey)`. The callback must be `application/x-www-form-urlencoded`, every required field is format-checked, the merchant code must be ours, and the signature is compared in constant time. Failures answer 400/401 with the standard error body and leave a `REJECTED` `webhook_events` row (keyed by payload hash, so identical forgeries collapse into one row).
2. Duitku signs no timestamp, nonce, `resultCode` or `reference`, so a captured callback can be replayed or altered in those fields. Therefore **no callback field decides a payment**: the callback only triggers verify-by-fetch (Check Transaction, called by us over TLS with our signature), and the fetched status, reference and amount decide (tested: a replayed "success" callback changes nothing while Duitku reports pending).
3. `webhook_events UNIQUE(source, event_key)` with `event_key = merchantOrderId:reference:resultCode`; a redelivery of a processed event is acknowledged without work. Concurrent duplicates serialize on the payment row lock and the conditional order transition: one PAID transition, one `PAYMENT_CONFIRMED` outbox event (tested with 5 concurrent deliveries).
4. Amount (exact decimal, both the callback and the fetched value), currency (IDR), reference and order state must match the stored payment, whose amount is the order total snapshot. Any mismatch → order `RECONCILIATION_REQUIRED` + reconciliation case, never `PAID`. Money confirmed for an order that already expired or was cancelled is recorded (payment PAID) with a reconciliation case; the order is not reopened and no `PAYMENT_CONFIRMED` event (the fulfillment trigger) is written. Repeated and concurrent late callbacks still produce one case and one alert (tested for customer-cancelled and expired orders).
5. The payment amount is never accepted from the browser: the request body is a strict `{ paymentMethod }` (tested with `amount` and `total`). The gateway receives the stored order total only.
6. The webhook route is `@Public` + `@SkipCsrf` (authenticated by signature), rate-limited at 300 per minute per IP, and optionally restricted to Duitku's published source IPs (`DUITKU_CALLBACK_ALLOWED_IPS`). Allow-list it in the Cloudflare WAF so challenges do not block Duitku (Phase 18).
7. Payment creation and status routes reuse the order access rules: owner-scoped for customers (another customer's order is 404), tracking token for guests (uniform 404, no-referrer), CSRF on POST, `Idempotency-Key` required. Rate limits: creation 20 per 10 min per IP and 30 per hour per principal; guest status reads 60 per minute per IP.
8. Secrets: `DUITKU_MERCHANT_CODE` and `DUITKU_API_KEY` are secret files, never logged (`signature` and `apiKey` are redacted keys), never stored in the database, never returned. Duitku response bodies are not logged; only HTTP status and operation. Stored webhook payloads drop the signature and customer data (`merchantUserId`, `customerName`, `spUserHash`).
9. Card data is never handled by us. Payment is via the Duitku hosted page (VA, retail, e-wallet, QRIS), so PCI scope stays minimal (SAQ A-type). Card, paylater and account-link methods are not enabled (docs/integrations/duitku.md §9).

## 6. Roblox and customer credentials

**R-01 is an architectural constraint.** No unofficial Roblox fulfillment adapter is implemented. Not implemented under any circumstance: password harvesting, persistent Roblox password storage, cookie/session theft, authentication bypass, CAPTCHA bypass, unauthorized browser automation, account takeover techniques, undocumented/private API abuse. `MockFulfillmentProvider` is used until an authorized provider and its API contract are established. The mock (Phase 8, ADR-005) is a deterministic simulator for development and tests that calls nothing external; it is not a Roblox fulfillment provider. `NODE_ENV=production` with `FULFILLMENT_PROVIDER=mock` fails configuration loading in every process, and an unknown provider name fails too, so production never fulfills through the mock and never falls back to it. Provider requests carry the recipient's username of the product's platform (Roblox or Telegram; none for digital delivery, Phase 11), the user id once resolved, the amount in the product line's units and our client reference only; provider call logs carry references, normalized status and error codes, never the recipient. Source management (Phase 10) never sets or returns credentials or `credential_ref` (that stays with `sources.credentials.manage`); OPERATOR sees sources without their cost per unit; changes need `inventory.manage` and are audited; customer endpoints expose no source, cost, routing score or provider error. The fulfillment engine (Phase 9) builds that request from the order row only; it never handles passwords, cookies, session or CAPTCHA tokens, payment data or the guest tracking token, and its history, attempt rows and logs hold identifiers, normalized error codes and amounts, never raw provider responses.

Hard rules (PRD §5, master prompt §16):

- The platform **never asks for, accepts, stores, logs or forwards a customer's Roblox password, cookie (`.ROBLOSECURITY`), or session token.** There is no form field for them. API DTOs reject unknown fields, so they cannot be sent by accident.
- Customer identification uses: (a) username → user id lookup through an official/documented Roblox API, or (b) Roblox OAuth 2.0 (Open Cloud) sign-in with `openid profile` scopes. Exact endpoints to be confirmed against official Roblox documentation in Phase 11; nothing is invented.
- No browser automation against Roblox, no scraping behind authentication, no use of customer accounts to perform actions.
- If a future authorized provider requires a temporary credential, it flows request → TLS → memory → use → discard. It is excluded from logs, job payloads, Redis, Sentry and DB by type (a `SecretValue` wrapper whose `toJSON`/`toString` return `[REDACTED]`).

Source/provider credentials (platform-owned) are secrets: stored outside the database (Docker secrets or host env, later a secrets manager), referenced by name in `fulfillment_sources.credential_ref`, never returned by any API, never visible to OPERATOR.

## 7. Input validation and web security

| Control | Detail | Phase |
|---------|--------|-------|
| Validation | zod schemas from `packages/shared` on every endpoint; unknown keys rejected; numeric bounds; string lengths. | 1+ |
| SQL injection | Prisma parameterised queries. Raw SQL only through `$queryRaw` tagged templates (parameterised), never `$queryRawUnsafe` with user input. Lint rule bans `$queryRawUnsafe`/`$executeRawUnsafe`. | 2 |
| XSS | React escaping; no `dangerouslySetInnerHTML` with user content (lint rule); strict CSP. | 1+ |
| CSP | Nonce-based `script-src`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action` limited to self and the payment gateway. Report-only first, then enforce. | 16 |
| CSRF | Every POST/PUT/PATCH/DELETE needs an `Origin` (or `Referer`) from `TRUSTED_ORIGINS`; requests with neither are rejected. With a session, `X-CSRF-Token` must equal HMAC-SHA256(`CSRF_SECRET`, session token hash), served by `GET /api/v1/auth/session`. SameSite=Lax is defence in depth only. Webhooks will opt out explicitly (`@SkipCsrf`) and authenticate by signature. All cases tested. | 3 |
| CORS | Browser traffic is same-origin (ADR-008), so browsers need no CORS. The API still answers CORS only for the exact `TRUSTED_ORIGINS` (wildcards and paths are rejected at startup), with credentials; other origins get no `Access-Control-Allow-Origin` (tested). | 3 |
| Headers | HSTS (with preload once stable), `X-Content-Type-Options`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`. Set at Nginx and via `helmet`. | 1 / 16 |
| Rate limiting | Redis fixed windows (atomic Lua INCR + EXPIRE) under the `rl:` prefix, separate from BullMQ (`bull:`); emails are hashed before they reach Redis. Fails closed (503) when Redis is unavailable, because these limits guard authentication. Customer login 10 per 15 min per IP+email and 30 per 15 min per IP; staff login 5 and 20; registration 5 per hour per IP; 2FA verify/activate/recovery 5 per 5 min per user and 20 per 15 min per IP; 2FA setup 10 per 15 min per user; password change 5 per 15 min per user; logout 30 per min per IP; guest tracking 30 per min per IP; order creation 20 per 10 min per IP and 30 per hour per principal; guest cancellation 10 per 10 min per IP. `Retry-After` is returned. Coarse Nginx limits sit in front. Payment creation 20 per 10 min per IP and 30 per hour per principal; guest payment status 60 per min per IP; payment callbacks 300 per min per IP (Phase 6). Roblox endpoints get limits in their phase. | 3 |
| Anti-abuse | Order velocity limits per user/IP/recipient, duplicate-order detection, payment-mismatch tracking. Risk signals accumulate; no single-signal auto-ban (PRD §83). | 16 |
| Error responses | `{ code, message, requestId }` only. Stack traces, SQL errors and provider responses never leave the server. Body-parser failures map to `PAYLOAD_TOO_LARGE` (413, JSON limit 100 kB) and `VALIDATION_FAILED` (malformed JSON) and still carry a request id. | 1 / 5 |
| Order integrity | The browser never sends amounts: the order schema is strict, so a client total, price or discount is rejected (tested). Totals come from `quotePrice`; an order based on an outdated price version fails with `PRICE_CHANGED` instead of charging another amount. Idempotency keys are scoped per customer (or to guests), so another customer cannot replay a stored response; the replay copy of the tracking token is encrypted with `IDEMPOTENCY_ENCRYPTION_KEY`. | 5 |

## 8. Secrets management

- Never committed: `.env*` (except `.env.example`), keys, certificates, dumps. `.gitignore` and a secret scanner (`gitleaks`) in pre-commit and CI from Phase 1.
- `.env.example` documents every variable with a placeholder and purpose.
- Production: secrets injected at runtime (Compose `secrets:` files with `0400` permissions, owned by root, or host env). Not in images, not in build args, not in Compose files committed to git.
- Rotation procedure documented in `RUNBOOK.md` for: DB password, Redis password, session secret, TOTP encryption key (versioned), payment keys, provider credentials, notification tokens.
- Config validation at boot (zod) fails fast on missing or weak secrets (minimum length / entropy for session and encryption keys).

## 9. Logging and privacy

- Structured JSON logs; redaction of `authorization`, `cookie`, `set-cookie`, `x-csrf-token`, `idempotency-key` headers and of `password`, `token`, `secret`, `apiKey`, `signature`, `totp`, `recoveryCode(s)`, `credential(s)`, `trackingToken`, `sessionToken`, `csrfToken`, `idempotencyKey` keys (top level and two levels deep).
- The guest tracking token is part of the URL (`/track/:token`). The API request log writes that segment as `/track/[REDACTED]`, because the frontend container calls the API directly and bypasses the Nginx log masking (tested with a real request through the API logger, and checked in the dev and production stacks).
- IP addresses stored for security events; masked in general logs. Retention periods defined in `RUNBOOK.md` (proposal: app logs 30 days, audit logs ≥ 1 year).
- Analytics/Sentry receive no PII beyond an internal user id.

## 10. Infrastructure

| Control | Detail | Phase |
|---------|--------|-------|
| Network isolation | `app` and `data` networks `internal: true`; Postgres/Redis only on `data`, never published in any environment. Only `nginx` publishes ports (80/443). No PM2 or host-run app processes (ADR-002). Note: Docker-published ports bypass host firewalls such as UFW, so "not published" is the control, not the firewall. | 1 |
| Origin protection | Host firewall: 80/443 from Cloudflare ranges only; SSH key-only, non-default user, fail2ban or equivalent. Cloudflare Full (strict) TLS with Origin Certificate; Authenticated Origin Pulls. | 18 |
| Containers | Non-root users, read-only root filesystem where feasible, `no-new-privileges`, dropped capabilities, resource limits, no Docker socket mounts. | 1 / 16 |
| Images | Multi-stage, prod deps only, pinned base, `trivy` scan in CI. | 1 / 16 |
| Database | Separate DB roles: migration role (DDL) vs app role (DML, no DDL, no audit-log UPDATE/DELETE). TLS not required inside the private network on a single host; required if DB moves to managed service. | 2 |
| Redis | `requirepass`/ACL user, `noeviction`, AOF, dangerous commands renamed/disabled (`FLUSHALL`, `CONFIG`, `KEYS`). | 1 / 7 |
| Backups | Encrypted, off-host, restore tested before claiming they work (master prompt §46). | 18 |
| Admin surface | `/admin` and `/api/v1/admin` optionally behind Cloudflare Access (recommended). | 18 |

## 11. Incident response (outline, detailed in RUNBOOK.md)

1. Kill switch: global `FULFILLMENT_ENABLED` flag (DB-backed, admin-toggleable, audited) pauses execution without stopping payment intake; per-source disable.
2. Credential compromise: rotate, revoke all admin sessions (`DELETE FROM user_sessions WHERE role >= OPERATOR`), review audit log.
3. Suspected double fulfillment: pause fulfillment, run reconciliation, compare provider ledger.

## 12. Pre-production security review checklist (Phase 16)

Authentication · Authorization · 2FA · Session management · Rate limiting · Input validation · SQL injection · XSS · CSRF · CORS · CSP · Secrets · Webhooks · Idempotency · Inventory race conditions · Payment race conditions · Logging/redaction · Docker security · Network exposure · Backup/restore tested · Dependency audit clean (no high/critical) · Pen-test of checkout, webhook and admin flows.
